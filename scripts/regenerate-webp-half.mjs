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

    // Seek after -i so the frame is properly decoded, and verify it is not empty
    // before writing: an unchecked frame is how black posters got published.
    const frameHasContent = (pngPath) => {
      if (!fs.existsSync(pngPath)) return false;
      try {
        const raw = execSync(
          `ffmpeg -y -v error -i "${pngPath}" -vf scale=48:48 -pix_fmt gray -f rawvideo -`,
          { stdio: ["ignore", "pipe", "ignore"], maxBuffer: 64 * 1024 * 1024 }
        );
        if (!raw || raw.length < 100) return false;
        let lit = 0;
        for (let i = 0; i < raw.length; i++) if (raw[i] > 24) lit++;
        return lit >= 24 && lit / raw.length >= 0.02;
      } catch {
        return false;
      }
    };

    const probePng = `${webpPath}.probe.png`;
    let goodSs = null;
    for (const ss of [0, 0.15, 0.35, 0.6, 0.9]) {
      try {
        execSync(`ffmpeg -y -v error -ss ${ss} -i "${webmPath}" -vframes 1 -c:v png "${probePng}"`, {
          stdio: "pipe",
          timeout: 60000,
        });
      } catch {}
      if (frameHasContent(probePng)) { goodSs = ss; break; }
      try { fs.unlinkSync(probePng); } catch {}
    }

    if (goodSs === null) {
      console.error(`${entryId}: no frame with visible content; poster left untouched.`);
      failed++;
      continue;
    }

    try {
      execSync(
        `ffmpeg -y -v error -ss ${goodSs} -i "${webmPath}" -vframes 1 -s ${dim} -c:v libwebp -q:v 50 "${webpPath}"`,
        { stdio: "pipe", timeout: 60000 }
      );
    } catch {}
    try { fs.unlinkSync(probePng); } catch {}

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
