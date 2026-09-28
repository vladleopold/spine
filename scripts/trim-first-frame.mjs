#!/usr/bin/env node
/**
 * Remove the black frames at the start of already-exported preview WebMs.
 *
 * The exporter used to start MediaRecorder while the canvas was still blank,
 * so each preview begins with a run of background-only frames (7 frames at
 * 30fps in the case of skeleton-2026-09-05). This drops that whole run and
 * retimes the remainder, so frame 0 becomes the first frame that actually has
 * an image. Files whose frame 0 already has content are left untouched and
 * are not re-encoded at all.
 *
 * Detection uses YMAX, not YAVG: YUV limited range puts black at Y=16, so a
 * visually black frame still reports YAVG ~20 and looks "fine".
 *
 * Usage:
 *   node scripts/trim-first-frame.mjs [--dry-run] [--limit N] [--shard I/N]
 *   node scripts/trim-first-frame.mjs --posters
 *     --posters  after trimming, also rewrites every WebP poster in the
 *                library from the new frame 0 (same first-frame rule as
 *                scripts/regenerate-webp.mjs)
 */
import fs from "fs";
import path from "path";
import os from "os";
import { execFileSync } from "child_process";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const LIBRARY = path.join(ROOT, "library");

// A frame whose peak luma is below this has no visible pixel.
const BLACK_PEAK = 40;
// Never cut more than this many frames even if the whole clip looks black.
const MAX_CUT = 120;
const CONCURRENCY = Math.max(2, Math.min(8, os.cpus().length - 1));
const FFMPEG = "ffmpeg";
const FFPROBE = "ffprobe";

const argv = process.argv.slice(2);
const dryRun = argv.includes("--dry-run");
const withPosters = argv.includes("--posters");
const limitIdx = argv.indexOf("--limit");
const limit = limitIdx >= 0 ? Number(argv[limitIdx + 1]) : Infinity;
const shardIdx = argv.indexOf("--shard");
const shard = shardIdx >= 0 ? String(argv[shardIdx + 1]).split("/").map(Number) : null;

function run(cmd, args) {
  return execFileSync(cmd, args, { encoding: "utf8", maxBuffer: 1024 * 1024 * 64, stdio: ["ignore", "pipe", "pipe"] });
}

/** Per-frame peak luma for the whole clip, in decode order. */
function framePeaks(webmPath) {
  // metadata=print:file=- writes to stdout, so capture stdout explicitly.
  const out = run(FFMPEG, [
    "-v", "error",
    "-i", webmPath,
    "-vf", "signalstats,metadata=print:file=-",
    "-f", "null", "-",
  ]);
  const markers = [...out.matchAll(/frame:(\d+)\s/g)];
  const peaks = [];
  for (const m of markers) {
    const seg = out.slice(m.index, m.index + 4000);
    const y = /YMAX=([0-9.]+)/.exec(seg);
    if (y) peaks.push(parseFloat(y[1]));
  }
  return peaks;
}

function frameRate(webmPath) {
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
  } catch { /* default below */ }
  return 30;
}

function dims(webmPath) {
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

function listWebms(dir, out = []) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    if (item.name.startsWith(".")) continue;
    const full = path.join(dir, item.name);
    if (item.isDirectory()) listWebms(full, out);
    else if (item.name.toLowerCase().endsWith(".webm")) out.push(full);
  }
  return out;
}

function listWebps(dir, out = []) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    if (item.name.startsWith(".")) continue;
    const full = path.join(dir, item.name);
    if (item.isDirectory()) listWebps(full, out);
    else if (item.name.toLowerCase().endsWith(".webp")) out.push(full);
  }
  return out;
}

if (!fs.existsSync(LIBRARY)) {
  console.error("library/ not found");
  process.exit(1);
}

let all = listWebms(LIBRARY);
if (shard) {
  const [i, n] = shard;
  all = all.filter((_, idx) => idx % n === i);
  console.error(`Shard ${i}/${n}: ${all.length} WebM files`);
}
console.error(`Scanning ${all.length} WebM files for a black first frame (peak < ${BLACK_PEAK})...`);

const candidates = [];
let scanned = 0;
for (const file of all) {
  scanned += 1;
  if (candidates.length >= limit) break;
  let peaks;
  try {
    peaks = framePeaks(file);
  } catch {
    continue;
  }
  if (!peaks.length) continue;
  if (peaks[0] >= BLACK_PEAK) continue; // first frame is fine, leave it alone

  let cut = 0;
  while (cut < peaks.length && cut < MAX_CUT && peaks[cut] < BLACK_PEAK) cut += 1;
  if (cut <= 0) continue;
  // Everything is black: nothing to gain from cutting, and cutting would
  // leave an empty clip. Keep such files and let the poster step flag them.
  if (cut >= peaks.length) {
    console.error(`  all-black, skipped: ${path.relative(ROOT, file)} (${peaks.length} frames)`);
    continue;
  }
  candidates.push({ file, cut, from: peaks[0], to: peaks[cut] });
}
console.error(`Scanned ${scanned}; files with black leading frames: ${candidates.length}`);

if (dryRun) {
  for (const c of candidates.slice(0, 30)) {
    console.error(`  would cut ${c.cut} frame(s) from ${path.relative(ROOT, c.file)} (YMAX ${c.from.toFixed(0)} -> ${c.to.toFixed(0)})`);
  }
  console.error(`Dry run: ${candidates.length} files would be trimmed.`);
  process.exit(0);
}

let trimmed = 0;
let failed = 0;

async function trimOne({ file, cut }) {
  const rel = path.relative(ROOT, file);
  const tmp = `${file}.trim.webm`;
  const fps = frameRate(file);
  try {
    run(FFMPEG, [
      "-y", "-v", "error",
      "-i", file,
      // Drop the leading black run, then retime so the first visible frame
      // lands back on t=0.
      "-vf", `trim=start_frame=${cut},setpts=N/(${fps.toFixed(6)}*TB)`,
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
    fs.renameSync(tmp, file);
    trimmed += 1;
    console.error(`cut ${cut} frame(s): ${rel}`);
  } catch (err) {
    failed += 1;
    try { fs.rmSync(tmp, { force: true }); } catch { /* ignore */ }
    console.error(`FAILED ${rel}: ${String(err.message).slice(0, 160)}`);
  }
}

let cursor = 0;
async function worker() {
  while (cursor < candidates.length) {
    const item = candidates[cursor];
    cursor += 1;
    await trimOne(item);
  }
}

await Promise.all(Array.from({ length: CONCURRENCY }, () => worker()));
console.error(`\nTrimmed: ${trimmed}, failed: ${failed}, of ${candidates.length} candidates.`);

if (withPosters) {
  // Re-take posters from the new frame 0. Same rule as regenerate-webp.mjs:
  // the poster is the first frame, no fallback frames.
  const webps = listWebps(LIBRARY);
  let posters = 0;
  let posterFailed = 0;
  for (const poster of webps) {
    const dir = path.dirname(poster);
    const webm = ["preview.webm", "preview-medium.webm", "preview-low.webm"]
      .map((n) => path.join(dir, n))
      .find((p) => fs.existsSync(p));
    if (!webm) continue;
    const base = path.basename(poster).toLowerCase();
    const { w, h } = dims(webm);
    if (!w || !h) continue;
    let dim;
    let quality;
    if (base === "preview.webp" || base === "preview.webm") { dim = `${w}x${h}`; quality = 50; }
    else if (base === "preview-medium.webp") {
      const s = Math.min(1, 1080 / w);
      dim = `${Math.round(w * s) & ~1}x${Math.round(h * s) & ~1}`; quality = 30;
    } else if (base === "preview-low.webp") {
      const s = Math.min(1, 360 / w);
      dim = `${Math.round(w * s) & ~1}x${Math.round(h * s) & ~1}`; quality = 15;
    } else { continue; }
    try {
      // libwebp is not built into every ffmpeg (notably Homebrew builds on
      // macOS), so fall back to cwebp / ImageMagick like the exporter does.
      const png = `${poster}.frame.png`;
      try {
        run(FFMPEG, ["-y", "-v", "error", "-ss", "0", "-i", webm, "-vframes", "1", "-s", dim, "-c:v", "png", png]);
        try {
          run("cwebp", ["-quiet", png, "-q", String(quality), "-o", poster]);
        } catch {
          run("convert", [png, "-quality", String(quality), poster]);
        }
      } finally {
        try { fs.rmSync(png, { force: true }); } catch { /* ignore */ }
      }
      posters += 1;
    } catch (err) {
      posterFailed += 1;
      console.error(`poster FAILED ${path.relative(ROOT, poster)}: ${String(err.message).slice(0, 120)}`);
    }
  }
  console.error(`\nPosters rewritten from new frame 0: ${posters}, failed: ${posterFailed}, of ${webps.length} webp files.`);
}

process.exit(0);
