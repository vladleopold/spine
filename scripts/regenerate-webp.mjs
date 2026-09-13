#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { execSync } from "child_process";
import https from "https";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const INDEX_PATH = path.join(ROOT, "library/index.json");
const SITE = "https://spine-link.vercel.app";

const index = JSON.parse(fs.readFileSync(INDEX_PATH, "utf8"));

function downloadFile(url, dest) {
  return new Promise((resolve, reject) => {
    const file = fs.createWriteStream(dest);
    https.get(url, (response) => {
      if (response.statusCode === 301 || response.statusCode === 302) {
        https.get(response.headers.location, (res2) => {
          res2.pipe(file);
          file.on("finish", () => { file.close(); resolve(); });
        }).on("error", reject);
      } else {
        response.pipe(file);
        file.on("finish", () => { file.close(); resolve(); });
      }
    }).on("error", (err) => { fs.unlink(dest, () => {}); reject(err); });
  });
}

function frameLumaAvg(mediaPath) {
  try {
    const out = execSync(
      `ffmpeg -i "${mediaPath}" -vf signalstats,metadata=print:file=- -frames:v 1 -f null - 2>&1`,
      { encoding: "utf8" }
    ).replace(/\r/g, "\n");
    const match = out.match(/lavfi\.signalstats\.YAVG=([0-9.]+)/);
    return match ? parseFloat(match[1]) : null;
  } catch {
    return null;
  }
}

function probeDuration(webmPath) {
  try {
    const out = execSync(`ffprobe -v error -show_entries format=duration -of csv=p=0 "${webmPath}"`, { encoding: "utf8" }).trim();
    const seconds = parseFloat(out);
    return Number.isFinite(seconds) && seconds > 0 ? seconds : 0;
  } catch {
    return 0;
  }
}

const entries = index.filter((e) => !e.hiddenFromPublicLibrary && e.thumbnailPoster);

console.error(`Checking ${entries.length} entries for broken posters...`);

let fixed = 0;
let skipped = 0;
let failed = 0;
let indexChanged = false;

for (const entry of entries) {
  const match = entry.thumbnailPoster.match(/\/assets\/(.*?)(?:\?|$)/);
  if (!match) continue;

  const localRel = match[1].replace(/^library\//, "library/");
  const localPath = path.join(ROOT, localRel);
  const dir = path.dirname(localPath);

  const exists = fs.existsSync(localPath);
  const size = exists ? fs.statSync(localPath).size : 0;

  // Fast path: large posters are very likely fine — skip without decoding.
  if (exists && size > 60000) {
    skipped++;
    continue;
  }

  // Small/broken posters always regenerate. Existing posters <= 60 KB are
  // checked for blackness so no black WebP poster remains on the page.
  let existingLuma = null;
  if (exists && size > 0) {
    existingLuma = frameLumaAvg(localPath);
    if (existingLuma !== null && existingLuma >= 8) {
      skipped++;
      continue;
    }
  }

  console.error(`Processing ${entry.id} (${size} bytes, YAVG ${existingLuma === null ? "n/a" : existingLuma.toFixed(1)})...`);

  let webmPath = path.join(dir, "preview.webm");
  if (!fs.existsSync(webmPath) || fs.statSync(webmPath).size < 1000) {
    const webmUrl = entry.webmPreview || `${SITE}/assets/${localRel.replace(/preview.*\.webp$/, "preview.webm")}`;
    console.error(`  Downloading WebM from ${webmUrl}`);
    try {
      fs.mkdirSync(dir, { recursive: true });
      await downloadFile(webmUrl + "?t=" + Date.now(), webmPath);
    } catch (err) {
      console.error(`  Failed to download WebM: ${err.message.slice(0, 100)}`);
      failed++;
      continue;
    }
  }

  if (!fs.existsSync(webmPath) || fs.statSync(webmPath).size < 1000) {
    console.error(`  No valid WebM for ${entry.id}`);
    failed++;
    continue;
  }

  try {
    const probe = execSync(
      `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "${webmPath}"`,
      { encoding: "utf8" }
    ).trim();
    const [wStr, hStr] = probe.split(",");
    const w = parseInt(wStr, 10);
    const h = parseInt(hStr, 10);
    if (!w || !h) {
      console.error(`  Skipping ${entry.id}: cannot probe dimensions`);
      skipped++;
      continue;
    }

    const duration = probeDuration(webmPath);
    const candidates = duration > 0
      ? [
          Math.min(2, Math.max(0.05, duration * 0.6)),
          Math.min(1.2, Math.max(0.05, duration * 0.35)),
          Math.min(0.6, Math.max(0.05, duration * 0.12)),
          Math.max(0.05, duration - 0.15),
        ]
      : [0.75, 0.4, 0.15, 0.05];

    // Pick the first frame that is not black; fall back to the first candidate
    // so a poster file is never left empty even when the source is dark.
    const pngPath = path.join(dir, ".frame-check.png");
    let chosenTime = candidates[0];
    let chosenLuma = null;
    try {
      for (const time of candidates) {
        try { fs.unlinkSync(pngPath); } catch {}
        try {
          execSync(`ffmpeg -y -ss ${time} -i "${webmPath}" -vframes 1 "${pngPath}"`, { stdio: "pipe", timeout: 30000 });
        } catch {}
        if (!fs.existsSync(pngPath) || fs.statSync(pngPath).size < 100) continue;
        const luma = frameLumaAvg(pngPath);
        if (luma !== null && luma >= 8) {
          chosenTime = time;
          chosenLuma = luma;
          break;
        }
      }
      if (chosenLuma === null && fs.existsSync(pngPath) && fs.statSync(pngPath).size >= 100) {
        chosenLuma = frameLumaAvg(pngPath);
      }
    } finally {
      try { fs.unlinkSync(pngPath); } catch {}
    }
    console.error(`  Using frame at ${chosenTime.toFixed(2)}s of ${duration.toFixed(2)}s (YAVG ${chosenLuma === null ? "unknown" : chosenLuma.toFixed(1)})`);

    const extractFrame = (dim, outPath, quality) => {
      try {
        execSync(`ffmpeg -y -ss ${chosenTime} -i "${webmPath}" -vframes 1 -s ${dim} -c:v libwebp -q:v ${quality} "${outPath}"`, { stdio: "pipe", timeout: 30000 });
      } catch {}
      return fs.existsSync(outPath) && fs.statSync(outPath).size > 200;
    };

    const dimHigh = `${w}x${h}`;
    const scaleMed = Math.min(1, 1080 / w);
    const dimMedium = `${Math.round(w * scaleMed) & ~1}x${Math.round(h * scaleMed) & ~1}`;
    const scaleLow = Math.min(1, 360 / w);
    const dimLow = `${Math.round(w * scaleLow) & ~1}x${Math.round(h * scaleLow) & ~1}`;

    const thumbFiles = fs.readdirSync(dir).filter(
      (f) => f.endsWith("-preview.webp") && !["preview.webp", "preview-medium.webp", "preview-low.webp"].includes(f)
    );
    for (const thumbFile of thumbFiles) {
      extractFrame(dimHigh, path.join(dir, thumbFile), 50);
    }
    if (!fs.existsSync(localPath) || fs.statSync(localPath).size <= 200) {
      console.error(`  Creating poster ${path.basename(localPath)}...`);
      extractFrame(dimHigh, localPath, 50);
    }
    extractFrame(dimHigh, path.join(dir, "preview.webp"), 50);
    extractFrame(dimMedium, path.join(dir, "preview-medium.webp"), 30);
    extractFrame(dimLow, path.join(dir, "preview-low.webp"), 15);

    // Re-run every -preview.webp output through luma check; fix the ones that
    // came out black (e.g. extra per-animation posters).
    const blackWebpFiles = [];
    for (const f of fs.readdirSync(dir).filter((x) => x.endsWith(".webp"))) {
      if (fs.statSync(path.join(dir, f)).size > 200) continue;
      blackWebpFiles.push(f);
    }
    const lumaOfPoster = fs.existsSync(localPath) && fs.statSync(localPath).size > 100 ? frameLumaAvg(localPath) : null;
    const posterBlack = lumaOfPoster === null || lumaOfPoster < 8;
    for (const f of blackWebpFiles) {
      const outPath = path.join(dir, f);
      extractFrame(dimHigh, outPath, 50);
      const luma = frameLumaAvg(outPath);
      if (luma !== null && luma >= 8) {
        console.error(`  Re-fixed black poster ${f} (YAVG ${luma.toFixed(1)})`);
      }
    }

    const mainPosterLuma = fs.existsSync(localPath) && fs.statSync(localPath).size > 100 ? frameLumaAvg(localPath) : null;
    const ok = mainPosterLuma !== null && mainPosterLuma >= 8;

    if (ok) {
      fixed++;
      // Bump the poster URL cache-buster so the CDN serves the new frame.
      if (String(entry.thumbnailPoster).startsWith("https://")) {
        const fresh = new Date().toISOString();
        entry.thumbnailPoster = String(entry.thumbnailPoster).replace(/[?&]v=[^&]*/, "") + `?v=${encodeURIComponent(fresh)}`;
        indexChanged = true;
      }
      console.error(`  Fixed ${entry.id} → main poster YAVG ${mainPosterLuma.toFixed(1)}`);
    } else {
      failed++;
      console.error(`  Still broken: ${entry.id} (poster YAVG ${mainPosterLuma === null ? "n/a" : mainPosterLuma.toFixed(1)})`);
    }
  } catch (err) {
    failed++;
    console.error(`  Failed ${entry.id}: ${err.message.slice(0, 200)}`);
  }
}

if (indexChanged) {
  fs.writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2), "utf8");
  console.error("Updated library/index.json cache-busters for regenerated posters");
}

console.error(`\nDone: ${fixed} fixed, ${skipped} skipped, ${failed} failed`);