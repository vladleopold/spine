import fs from "fs";
import path from "path";

const ROOT = path.resolve(path.dirname(new URL(import.meta.url).pathname), "..");
const INDEX_PATH = path.join(ROOT, "library/index.json");

const index = JSON.parse(fs.readFileSync(INDEX_PATH, "utf8"));
const entries = index.filter((e) => !e.hiddenFromPublicLibrary && e.thumbnailPoster);

console.error(`Checking ${entries.length} entries for black posters...`);

let removed = 0;
let kept = 0;

function isBlack(buf) {
  if (buf.length < 100) return true;
  const limit = Math.min(buf.length, 65536);
  let max = 0;
  for (let i = 0; i < limit; i += 3) {
    const r = buf[i];
    const g = buf[i + 1] || 0;
    const b = buf[i + 2] || 0;
    const bness = (r + g + b) / 3;
    if (bness > max) max = bness;
  }
  return max < 30;
}

for (const entry of entries) {
  const match = entry.thumbnailPoster.match(/\/assets\/(.*?)(?:\?|$)/);
  if (!match) continue;

  const localPath = path.join(ROOT, match[1]);

  if (!fs.existsSync(localPath)) {
    const idx = index.findIndex((e) => e.id === entry.id);
    if (idx >= 0) {
      index.splice(idx, 1);
      removed++;
      console.error(`Removed (missing): ${entry.id}`);
    }
    continue;
  }

  const buf = fs.readFileSync(localPath);
  if (isBlack(buf)) {
    fs.unlinkSync(localPath);
    const idx = index.findIndex((e) => e.id === entry.id);
    if (idx >= 0) {
      index.splice(idx, 1);
      removed++;
      console.error(`Removed (black): ${entry.id}`);
    }
  } else {
    kept++;
  }
}

fs.writeFileSync(INDEX_PATH, JSON.stringify(index, null, 2));
console.error(`Done: removed=${removed}, kept=${kept}`);
