#!/usr/bin/env node
import fs from "fs";
import path from "path";
import { execSync } from "child_process";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const INDEX_PATH = path.join(ROOT, "library/index.json");

const index = JSON.parse(fs.readFileSync(INDEX_PATH, "utf8"));

let processed = 0;
let skipped = 0;
let failed = 0;

for (const entry of index) {
  if (entry.hiddenFromPublicLibrary) continue;

  const entryId = entry.id;
  if (!entryId) continue;

  const webmPath = path.join(ROOT, "library", entryId, "preview.webm");
  if (!fs.existsSync(webmPath)) {
    skipped++;
    continue;
  }

  const webmSize = fs.statSync(webmPath).size;
  if (webmSize < 1000) {
    skipped++;
    continue;
  }

  const webpPath = path.join(ROOT, "library", entryId, "preview.webp");

  try {
    const probe = execSync(
      `ffprobe -v error -select_streams v:0 -show_entries stream=width,height -of csv=p=0 "${webmPath}"`,
      { encoding: "utf8" }
    ).trim();
    const [wStr, hStr] = probe.split(",");
    const w = parseInt(wStr, 10);
    const h = parseInt(hStr, 10);
    if (!w || !h) {
      failed++;
      continue;
    }

    const halfW = Math.max(1, Math.round(w / 2));
    const halfH = Math.max(1, Math.round(h / 2));
    const dim = `${halfW}x${halfH}`;

    try {
      execSync(
        `ffmpeg -y -i "${webmPath}" -vf "select=eq(n\\,0)" -vframes 1 -s ${dim} -c:v libwebp -q:v 50 "${webpPath}"`,
        { stdio: "pipe", timeout: 60000 }
      );
    } catch {
      execSync(
        `ffmpeg -y -ss 0 -i "${webmPath}" -vframes 1 -s ${dim} -c:v libwebp -q:v 50 "${webpPath}"`,
        { stdio: "pipe", timeout: 60000 }
      );
    }

    if (fs.existsSync(webpPath) && fs.statSync(webpPath).size > 500) {
      processed++;
      console.error(`${entryId}: ${webpPath} (${fs.statSync(webpPath).size} bytes, ${halfW}x${halfH})`);
    } else {
      failed++;
    }
  } catch (err) {
    failed++;
    console.error(`${entryId}: failed - ${err.message.slice(0, 100)}`);
  }
}

console.error(`Done: ${processed} generated, ${skipped} skipped, ${failed} failed`);
