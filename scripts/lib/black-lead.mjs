#!/usr/bin/env node
/**
 * Shared black-lead detection and trimming for Spine preview WebMs.
 *
 * Why this exists
 * ---------------
 * MediaRecorder used to start while the canvas was still blank, so every
 * exported preview began with a run of background-only frames. Some renderers
 * produce 7 such frames, others 21, because each variant is a separate player
 * load with its own startup latency. Waiting "long enough" before starting the
 * recorder is therefore unreliable; measuring the recorded file is not.
 *
 * Detection uses YMAX, not YAVG: YUV limited range puts black at Y=16, so a
 * visually black frame still reports YAVG ~20 and would look fine.
 *
 * Fades are content, not garbage
 * ------------------------------
 * An animation that deliberately fades in must survive untouched, so a leading
 * run is only cut when it is *flat* black:
 *
 *   - every frame in the run sits at or below FLAT_BLACK (28), i.e. there is no
 *     visible gradient anywhere in it. A fade-in climbs through 40, 70, 110,
 *     150 and therefore ends the run instead of extending it.
 *   - the run is long enough to be an artifact (MIN_CUT_FRAMES, 4). One or two
 *     dark frames at the head of a loop is normal and is left alone.
 *   - real content follows and stays visible for MIN_VISIBLE_FRAMES (6), so a
 *     clip that is legitimately dark all the way through is never cut.
 *   - the run is at most MAX_CUT frames and at most MAX_CUT_RATIO of the clip.
 *
 * A clip can be both: 10 flat black frames followed by a fade-in. The run ends
 * at the first frame at or above BLACK_PEAK, so only the flat part is removed
 * and the fade is preserved.
 */
import fs from "fs";
import { execFileSync } from "child_process";

const FFMPEG = process.env.FFMPEG_BIN || "ffmpeg";
const FFPROBE = process.env.FFPROBE_BIN || "ffprobe";

/** A frame whose peak luma is below this has no visible pixel. */
export const BLACK_PEAK = 40;
/** Below this a frame is not just dark, it is indistinguishable from black. */
export const FLAT_BLACK = 28;
/** Shorter leading runs are normal loop padding, not a capture artifact. */
export const MIN_CUT_FRAMES = 4;
/** Content must persist this long after the cut, or the clip stays as it is. */
export const MIN_VISIBLE_FRAMES = 6;
/** Hard cap on how many frames may ever be removed. */
export const MAX_CUT = 120;
/** Hard cap as a fraction of the clip. */
export const MAX_CUT_RATIO = 0.4;

export function run(cmd, args) {
  return execFileSync(cmd, args, {
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 64,
    stdio: ["ignore", "pipe", "pipe"],
  });
}

/** Per-frame peak luma for the whole clip, in decode order. */
export function framePeaks(webmPath) {
  // metadata=print:file=- writes to stdout, so capture stdout explicitly.
  const out = run(FFMPEG, [
    "-v", "error",
    "-i", webmPath,
    "-vf", "signalstats,metadata=print:file=-",
    "-f", "null", "-",
  ]);
  const peaks = [];
  for (const m of out.matchAll(/frame:(\d+)\s/g)) {
    const seg = out.slice(m.index, m.index + 4000);
    const y = /YMAX=([0-9.]+)/.exec(seg);
    if (y) peaks.push(parseFloat(y[1]));
  }
  return peaks;
}

export function frameRate(webmPath) {
  try {
    const out = run(FFPROBE, [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=r_frame_rate",
      "-of", "default=nw=1:nk=1",
      webmPath,
    ]).trim();
    const [num, den] = out.split("/").map(Number);
    if (Number.isFinite(num) && Number.isFinite(den) && den > 0) return num / den;
  } catch { /* fall through to the default */ }
  return 30;
}

export function dims(webmPath) {
  try {
    const out = run(FFPROBE, [
      "-v", "error",
      "-select_streams", "v:0",
      "-show_entries", "stream=width,height",
      "-of", "csv=p=0",
      webmPath,
    ]).trim();
    const [w, h] = out.split(",").map(Number);
    return { w, h };
  } catch {
    return { w: 0, h: 0 };
  }
}

/**
 * Decide how many leading frames to drop.
 *
 * @returns {{cut: number, reason: string, peaks: number[], run: number}}
 *   cut is 0 whenever the clip must be left alone.
 */
export function analyzeBlackLead(peaks) {
  const noop = (reason) => ({ cut: 0, reason, peaks, run: 0 });

  if (!Array.isArray(peaks) || peaks.length < MIN_CUT_FRAMES + MIN_VISIBLE_FRAMES) {
    return noop("too-short");
  }

  let run = 0;
  while (run < peaks.length && peaks[run] < BLACK_PEAK) run += 1;

  if (run === 0) return noop("clean-first-frame");
  if (run >= peaks.length) return noop("all-black");

  if (run < MIN_CUT_FRAMES) return noop("short-run-kept");

  // A fade-in climbs out of black gradually. Intermediate values inside the
  // run mean the ramp is deliberate content, so stop at the first one.
  let flatEnd = run;
  for (let i = 0; i < run; i += 1) {
    if (peaks[i] > FLAT_BLACK) {
      flatEnd = i;
      break;
    }
  }
  if (flatEnd < MIN_CUT_FRAMES) return noop("fade-in-kept");

  // Content has to actually arrive, and stay.
  const visible = peaks.slice(flatEnd);
  let firstVisible = 0;
  while (firstVisible < visible.length && visible[firstVisible] < BLACK_PEAK) firstVisible += 1;
  if (firstVisible >= visible.length) return noop("no-visible-content");
  const after = visible.slice(firstVisible);
  if (after.filter((p) => p >= BLACK_PEAK).length < MIN_VISIBLE_FRAMES) {
    return noop("content-too-brief");
  }

  if (flatEnd > MAX_CUT) return noop("over-max-cut");
  if (flatEnd / peaks.length > MAX_CUT_RATIO) return noop("over-max-ratio");

  return { cut: flatEnd, reason: "black-lead", peaks, run };
}

/** Measure a file and trim it in place if it starts with a flat black run. */
export function trimBlackLead(webmPath, { label = webmPath, log = () => {} } = {}) {
  let result;
  try {
    result = analyzeBlackLead(framePeaks(webmPath));
  } catch (err) {
    log(`  skip ${label}: could not analyse (${String(err.message).slice(0, 120)})`);
    return { trimmed: false, cut: 0, reason: "analysis-failed" };
  }

  if (!result.cut) {
    log(`  keep ${label}: ${result.reason}`);
    return { trimmed: false, cut: 0, reason: result.reason };
  }

  const tmp = `${webmPath}.lead.webm`;
  try {
    run(FFMPEG, [
      "-y", "-v", "error",
      "-i", webmPath,
      // Drop the leading black run, then re-base timestamps to zero.
      //
      // setpts=PTS-STARTPTS is deliberately used instead of the usual
      // setpts=N/(FPS*TB): Matroska/WebM stores timestamps at millisecond
      // precision, so ffprobe reports r_frame_rate=1000/1 and avg_frame_rate
      // =0/0 for these clips. Deriving a frame rate from that would rescale
      // the whole clip to the wrong speed. PTS-STARTPTS needs no frame rate at
      // all and keeps the true duration.
      "-vf", `trim=start_frame=${result.cut},setpts=PTS-STARTPTS`,
      "-an",
      "-c:v", "libvpx-vp9",
      "-b:v", "0",
      "-crf", "34",
      "-deadline", "realtime",
      "-cpu-used", "5",
      "-row-mt", "1",
      "-pix_fmt", "yuv420p",
      tmp,
    ]);
    if (!fs.existsSync(tmp) || fs.statSync(tmp).size < 200) throw new Error("empty output");
    fs.renameSync(tmp, webmPath);
    log(`  cut ${result.cut} frame(s) of flat black from ${label}`);
    return { trimmed: true, cut: result.cut, reason: result.reason };
  } catch (err) {
    try { fs.rmSync(tmp, { force: true }); } catch { /* ignore */ }
    log(`  FAILED to trim ${label}: ${String(err.message).slice(0, 160)}`);
    return { trimmed: false, cut: 0, reason: "trim-failed" };
  }
}
