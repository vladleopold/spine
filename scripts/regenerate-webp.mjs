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

const entries = index.filter((e) => !e.hiddenFromPublicLibrary && e.thumbnailPoster);

console.error(`Regenerating first-frame posters for ${entries.length} entries...`);

let fixed = 0;
let skipped = 0;
let failed = 0;
let indexChanged = false;

// Poster = the first frame of the preview WebM. No fallback to later frames.
const FIRST_FRAME_SS = 0;

for (const entry of entries) {
  const match = entry.thumbnailPoster.match(/\/assets\/(.*?)(?:\?|$)/);
  if (!match) continue;

  const localRel = match[1].replace(/^library\//, "library/");
  const localPath = path.join(ROOT, localRel);
  const dir = path.dirname(localPath);

  console.error(`Processing ${entry.id}...`);

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

    const extractFrame = (dim, outPath, quality) => {
      try {
        execSync(`ffmpeg -y -ss ${FIRST_FRAME_SS} -i "${webmPath}" -vframes 1 -s ${dim} -c:v libwebp -q:v ${quality} "${outPath}"`, { stdio: "pipe", timeout: 30000 });
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

    fixed++;
    // Bump the poster URL cache-buster so the CDN serves the new frame.
    if (String(entry.thumbnailPoster).startsWith("https://")) {
      const fresh = new Date().toISOString();
      entry.thumbnailPoster = String(entry.thumbnailPoster).replace(/[?&]v=[^&]*/, "") + `?v=${encodeURIComponent(fresh)}`;
      indexChanged = true;
    }
    console.error(`  Done ${entry.id} → first-frame poster`);
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
