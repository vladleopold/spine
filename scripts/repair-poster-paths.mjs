#!/usr/bin/env node
/**
 * Point every stored poster URL at a file that actually exists.
 *
 * `thumbnail` and `thumbnailPoster` are written at upload time from whichever
 * per-animation poster the exporter produced, and they are stored as absolute
 * `/assets/...` URLs. Nothing later removes those files, so a re-export (or a
 * trim that rewrote the media) leaves the index pointing at a path that 404s.
 * The card then renders empty until the browser's onError stepper happens to
 * find a replacement.
 *
 * The exporter writes `preview.webp` for every entry, so that is the canonical
 * target. This script checks the library on disk -- the same checkout the
 * asset API reads from -- rather than trusting the stored URL, and rewrites
 * only the fields whose basename is genuinely absent.
 *
 * Usage: node scripts/repair-poster-paths.mjs [--dry-run]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LIBRARY = path.join(ROOT, "library");
const INDEX = path.join(LIBRARY, "index.json");
const dryRun = process.argv.includes("--dry-run");

if (!fs.existsSync(LIBRARY)) {
  console.error(`library/ not found at ${LIBRARY}.`);
  process.exit(1);
}
if (!fs.existsSync(INDEX)) {
  console.error("library/index.json not found; poster paths left unchanged.");
  process.exit(0);
}

let entries;
try {
  entries = JSON.parse(fs.readFileSync(INDEX, "utf8"));
} catch (err) {
  console.error(`Could not parse library/index.json: ${String(err.message).slice(0, 120)}`);
  process.exit(1);
}
if (!Array.isArray(entries)) {
  console.error("library/index.json is not an array of entries; left unchanged.");
  process.exit(1);
}

// The asset API answers 404 for preview-low.webp on purpose (commit c265a59,
// to stop cards showing a 360px thumbnail). Such a stored URL can never load,
// so it has to be repointed at the canonical poster like any other dead path --
// skipping it left those cards permanently black.
const BLOCKED = /\bpreview-low\.webp$/i;

const ORIGIN = "https://spine-link.vercel.app";
const CANONICAL = "preview.webp";

function storedBasename(value) {
  if (typeof value !== "string") return "";
  if (!value.includes("/assets/library/")) return "";
  // Drop any ?v= stamp; Vercel forwards it as ?v= to the API.
  const bare = value.split(/[?#]/, 1)[0];
  return path.posix.basename(decodeURIComponent(bare));
}

function entryDir(id) {
  return path.join(LIBRARY, decodeURIComponent(id));
}

function canonicalUrl(id) {
  return `${ORIGIN}/assets/library/${encodeURIComponent(id)}/${CANONICAL}`;
}

// webpPosterLow is a fallback poster the archive falls back to, so a dead
// preview-low.webp in it leaves those cards black too.
const FIELDS = ["thumbnail", "thumbnailPoster", "webpPosterLow"];
// thumbnailPosterPath / thumbnailPath hold a bare repo path, so they need their own
// pass: a blocked basename there still resolves to a dead file in the archive.
const PATH_FIELDS = ["thumbnailPosterPath", "thumbnailPath"];
let repaired = 0;
let blocked = 0;
let missingEntry = 0;
const repairedIds = new Set();
const details = [];

for (const e of entries) {
  if (!e || typeof e.id !== "string" || !e.id) continue;
  const dir = entryDir(e.id);
  if (!fs.existsSync(dir)) {
    missingEntry += 1;
    continue;
  }
  let present = null;
  const has = (name) => {
    if (present === null) {
      present = new Set(fs.readdirSync(dir, { withFileTypes: true }).filter((f) => f.isFile()).map((f) => f.name));
    }
    return present.has(name);
  };

  for (const field of FIELDS) {
    const current = e[field];
    const name = storedBasename(current);
    if (!name) continue;
    // preview-low.webp is served as 404, so a stored pointer at it is always dead.
    if (BLOCKED.test(name)) blocked += 1;
    else if (has(name)) continue; // the file is right there; nothing to do

    const target = has(CANONICAL) ? CANONICAL : has("preview-medium.webp") ? "preview-medium.webp" : "";
    if (!target) {
      details.push(`  ${e.id}: ${name} is gone and no canonical poster exists; left as is.`);
      continue;
    }
    const next = target === CANONICAL
      ? canonicalUrl(e.id)
      : `${ORIGIN}/assets/library/${encodeURIComponent(e.id)}/${target}`;
    details.push(`  ${e.id}: ${field} ${name} -> ${target}`);
    repairedIds.add(e.id);
    e[field] = next;
    repaired += 1;
  }

  for (const field of PATH_FIELDS) {
    const current = String(e[field] || "").replace(/^\/+/, "").replace(/\/+$/, "");
    if (!current) continue;
    const name = current.split("/").pop() || "";
    if (!BLOCKED.test(name) || !has(CANONICAL)) continue;
    details.push(`  ${e.id}: ${field} ${name} -> ${CANONICAL}`);
    repairedIds.add(e.id);
    e[field] = current.replace(BLOCKED, CANONICAL);
    repaired += 1;
  }
}

console.error(
  `Repaired ${repaired} poster field(s) across ${repairedIds.size} entr${repairedIds.size === 1 ? "y" : "ies"}; ` +
  `repointed ${blocked} preview-low.webp poster(s) (served as 404); ${missingEntry} entr${missingEntry === 1 ? "y has no" : "ies have no"} directory on disk.`,
);
for (const d of details.slice(0, 60)) console.error(d);
if (details.length > 60) console.error(`  ... and ${details.length - 60} more`);

if (!repaired) {
  console.error("Nothing to repair.");
  process.exit(0);
}
if (dryRun) {
  console.error("Dry run; library/index.json left unchanged.");
  process.exit(0);
}

fs.writeFileSync(INDEX, `${JSON.stringify(entries, null, 2)}\n`);
console.error("Rewrote library/index.json.");
