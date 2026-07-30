#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { execSync } from "child_process";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const INDEX_PATH = path.join(ROOT, "library/index.json");

const index = JSON.parse(fs.readFileSync(INDEX_PATH, "utf8"));

const entries = index.filter(
  (e) =>
    !e.hiddenFromPublicLibrary &&
    e.webmPreviewPath &&
    fs.existsSync(path.join(ROOT, e.webmPreviewPath))
);

console.error(`Found ${entries.length} entries with WebM files`);

let fixed = 0;
let skipped = 0;
let failed = 0;

for (const entry of entries) {
  const webmPath = path.join(ROOT, entry.webmPreviewPath);
  const dir = path.dirname(webmPath);

  console.error(`Processing ${entry.id}...`);

  try {
    const probe = execSync(
      `ffprobe -v error -select_streams v:0 -show_entries stream=width,height,duration -of csv=p=0 "${webmPath}"`,
      { encoding: "utf8" }
    ).trim();
    const parts = probe.split(",");
    const w = parseInt(parts[0], 10);
    const h = parseInt(parts[1], 10);
    const dur = parseFloat(parts[2]) || 1;
    if (!w || !h) {
      console.error(`  Skipping ${entry.id}: cannot probe dimensions`);
      skipped++;
      continue;
    }

    const seekTime = Math.min(0.15, dur * 0.15);

    const extractFrame = (dim, outPath, quality) => {
      try {
        execSync(
          `ffmpeg -y -ss ${seekTime} -i "${webmPath}" -vframes 1 -s ${dim} -c:v libwebp -q:v ${quality} "${outPath}"`,
          { stdio: "pipe", timeout: 30000 }
        );
      } catch {
        try {
          execSync(
            `ffmpeg -y -i "${webmPath}" -vframes 1 -s ${dim} -c:v libwebp -q:v ${quality} "${outPath}"`,
            { stdio: "pipe", timeout: 30000 }
          );
        } catch (e2) {
          console.error(`  FFmpeg failed for ${outPath}: ${e2.message.slice(0, 200)}`);
        }
      }
    };

    const dimHigh = `${w}x${h}`;
    const scaleMed = Math.min(1, 1080 / w);
    const dimMedium = `${Math.round(w * scaleMed) & ~1}x${Math.round(h * scaleMed) & ~1}`;
    const scaleLow = Math.min(1, 360 / w);
    const dimLow = `${Math.round(w * scaleLow) & ~1}x${Math.round(h * scaleLow) & ~1}`;

    extractFrame(dimHigh, path.join(dir, "preview.webp"), 50);
    extractFrame(dimMedium, path.join(dir, "preview-medium.webp"), 30);
    extractFrame(dimLow, path.join(dir, "preview-low.webp"), 15);

    const thumbFiles = fs.readdirSync(dir).filter(
      (f) => f.endsWith("-preview.webp") && !["preview.webp", "preview-medium.webp", "preview-low.webp"].includes(f)
    );
    for (const thumbFile of thumbFiles) {
      extractFrame(dimHigh, path.join(dir, thumbFile), 50);
    }

    const allWebp = [];
    for (const f of fs.readdirSync(dir)) {
      if (f.endsWith(".webp")) {
        allWebp.push(fs.statSync(path.join(dir, f)).size);
      }
    }

    if (allWebp.some((s) => s > 500)) {
      fixed++;
      console.error(`  Fixed ${entry.id} → ${allWebp.join(", ")}`);
    } else {
      failed++;
      console.error(`  Still empty after extraction: ${entry.id}`);
    }
  } catch (err) {
    failed++;
    console.error(`  Failed ${entry.id}: ${err.message.slice(0, 200)}`);
  }
}

console.error(`\nDone: ${fixed} fixed, ${skipped} skipped (>500 bytes), ${failed} failed`);
