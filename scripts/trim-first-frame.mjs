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
import { analyzeBlackLead, framePeaks, dims, BLACK_PEAK } from "./lib/black-lead.mjs";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const LIBRARY = path.join(ROOT, "library");

// A frame whose peak luma is below this has no visible pixel.
// Never cut more than this many frames even if the whole clip looks black.
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



function listWebms(dir, out = []) {
  for (const item of fs.readdirSync(dir, { withFileTypes: true })) {
    if (item.name.startsWith(".")) continue;
    const full = path.join(dir, item.name);
    if (item.isDirectory()) listWebms(full, out);
    else if (item.name.toLowerCase().endsWith(".webm")) out.push(full);
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

  // Fade-aware detection: only a *flat* black lead is removable. A clip that
  // ramps out of black (luma climbing 17, 22, 30, 36, 45, ...) is a deliberate
  // fade-in and is left untouched, as is a short black pad or a clip that
  // never reveals any content. See scripts/lib/black-lead.mjs.
  const verdict = analyzeBlackLead(peaks);
  if (!verdict.cut) {
    if (verdict.reason === "all-black") {
      console.error(`  all-black, skipped: ${path.relative(ROOT, file)} (${peaks.length} frames)`);
    }
    continue;
  }
  candidates.push({ file, cut: verdict.cut, from: peaks[0], to: peaks[verdict.cut] });
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
const trimmedFiles = [];

async function trimOne({ file, cut }) {
  const rel = path.relative(ROOT, file);
  const tmp = `${file}.trim.webm`;
  try {
    run(FFMPEG, [
      "-y", "-v", "error",
      "-i", file,
      // Drop the leading black run, then re-base timestamps to zero.
      //
      // setpts=PTS-STARTPTS is deliberately used instead of the usual
      // setpts=N/(FPS*TB): Matroska/WebM stores timestamps at millisecond
      // precision, so ffprobe reports r_frame_rate=1000/1 and avg_frame_rate
      // =0/0 for these clips. Deriving a frame rate from that would rescale
      // the whole clip to the wrong speed. PTS-STARTPTS needs no frame rate at
      // all and keeps the true duration.
      "-vf", `trim=start_frame=${cut},setpts=PTS-STARTPTS`,
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
    trimmedFiles.push(file);
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
  //
  // Only directories that were actually trimmed are touched. Re-encoding
  // every poster in the library would make all shards rewrite the same files
  // and collide on push, for no benefit: a poster is only wrong if its source
  // clip started on a black frame.
  const trimmedDirs = new Set();
  for (const c of trimmedFiles) trimmedDirs.add(path.dirname(c));

  const webps = [];
  for (const dir of trimmedDirs) {
    for (const f of fs.readdirSync(dir, { withFileTypes: true })) {
      if (f.isFile() && f.name.toLowerCase().endsWith(".webp")) webps.push(path.join(dir, f.name));
    }
  }
  // Per-animation previews live in a nested animations/<set>/ folder, so
  // include those directories too.
  for (const dir of [...trimmedDirs]) {
    const animationsDir = path.join(dir, "animations");
    if (!fs.existsSync(animationsDir)) continue;
    for (const setDir of fs.readdirSync(animationsDir, { withFileTypes: true })) {
      if (!setDir.isDirectory()) continue;
      const sub = path.join(animationsDir, setDir.name);
      for (const f of fs.readdirSync(sub, { withFileTypes: true })) {
        if (f.isFile() && f.name.toLowerCase().endsWith(".webp")) webps.push(path.join(sub, f.name));
      }
    }
  }

  let posters = 0;
  let posterFailed = 0;
  console.error(`\nRewriting posters in ${trimmedDirs.size} trimmed directories (${webps.length} webp files)...`);
  for (const poster of webps) {
    const dir = path.dirname(poster);
    const base = path.basename(poster).toLowerCase();

    // Match the poster to the clip it was taken from. Standard posters use
    // the same basename ("preview.webp" <- "preview.webm"); per-animation
    // posters use "<name>-preview.webp" next to "<name>-preview.webm", and
    // their dimensions/quality come from that clip, not the entry's main one.
    const siblingWebm = base.replace(/\.webp$/, ".webm");
    let webm = path.join(dir, siblingWebm);
    let isMain = base === "preview.webp" || base === "preview-medium.webp" || base === "preview-low.webp";
    if (!fs.existsSync(webm) && isMain) {
      webm = ["preview.webm", "preview-medium.webm", "preview-low.webm"]
        .map((n) => path.join(dir, n))
        .find((p) => fs.existsSync(p)) || "";
    }
    if (!webm || !fs.existsSync(webm)) {
      // Per-animation posters sit in the entry root as "<set>-preview.webp"
      // while their clip lives in animations/<set>/ as
      // "<entry>-anim-<set>-preview.webm", so there is NO same-named sibling
      // to pair with. This is the layout the card poster actually comes from,
      // so without this the poster keeps the pre-trim black first frame even
      // though the clip next to it is already fixed.
      const m = /^(.+)-preview(?:-(medium|low))?\.webp$/.exec(base);
      if (!m) continue;
      const setDir = path.join(dir, "animations", m[1]);
      if (!fs.existsSync(setDir)) continue;
      const suffix = m[2] ? `-${m[2]}` : "";
      const clip = fs.readdirSync(setDir, { withFileTypes: true })
        .filter((f) => f.isFile() && f.name.toLowerCase().endsWith(".webm"))
        .map((f) => f.name)
        .filter((n) => n.includes(`-anim-${m[1]}-preview${suffix}.webm`))
        .sort()[0];
      if (!clip) continue;
      webm = path.join(setDir, clip);
    }
    const sourceWebm = webm;

    const { w, h } = dims(sourceWebm);
    if (!w || !h) continue;
    let dim;
    let quality;
    if (isMain && base === "preview-medium.webp") {
      const s = Math.min(1, 1080 / w);
      dim = `${Math.round(w * s) & ~1}x${Math.round(h * s) & ~1}`; quality = 30;
    } else if (isMain && base === "preview-low.webp") {
      const s = Math.min(1, 360 / w);
      dim = `${Math.round(w * s) & ~1}x${Math.round(h * s) & ~1}`; quality = 15;
    } else {
      dim = `${w}x${h}`;
      quality = 50;
    }
    try {
      // libwebp is not built into every ffmpeg (notably Homebrew builds on
      // macOS), so fall back to cwebp / ImageMagick like the exporter does.
      const png = `${poster}.frame.png`;
      try {
        run(FFMPEG, ["-y", "-v", "error", "-ss", "0", "-i", sourceWebm, "-vframes", "1", "-s", dim, "-c:v", "png", png]);
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

// Record the entry ids we touched, so their asset version can be bumped.
//
// The site builds each asset URL as "<file>?v=<webmGeneratedAt>-<posterGeneratedAt>-<proofHash>"
// (see spine-link lib/asset-version.js). Rewriting the .webm/.webp bytes does
// NOT change that query string, so both the Vercel edge and the browser keep
// serving the pre-trim clip from cache. Bumping the entry's webmGeneratedAt is
// what actually makes the new bytes visible on the site.
//
// This deliberately does NOT edit library/index.json itself. Every shard would
// rewrite that one 20 MB file with a different set of entries, so the rebase
// that stitches the shards together would conflict on it every single time and
// no shard could land. Instead each shard drops a small, shard-unique marker
// file, and the "Bump asset versions" workflow merges them in one pass.
const touched = new Set();
for (const file of trimmedFiles) touched.add(path.basename(path.dirname(file)));

if (touched.size) {
  const marker = path.join(LIBRARY, `trimmed-ids-${shard ? shard[0] : "all"}.json`);
  fs.writeFileSync(marker, `${JSON.stringify([...touched].sort(), null, 2)}\n`);
  console.error(`Recorded ${touched.size} touched entr${touched.size === 1 ? "y" : "ies"} in ${path.relative(ROOT, marker)}.`);
}

process.exit(0);
