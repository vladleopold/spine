#!/usr/bin/env node
/**
 * Bump the asset version of every entry the trim workflow touched.
 *
 * The site serves each asset as "<file>?v=<webmGeneratedAt>-<posterGeneratedAt>
 * -<proofHash>" (spine-link lib/asset-version.js), so a re-encoded .webm
 * hidden behind an unchanged query string is never refetched. Rewriting
 * webmGeneratedAt is what makes the new bytes visible.
 *
 * The trim shards are disjoint but they all share one 20 MB library/index.json,
 * so they cannot each edit it: they would conflict on every rebase. Instead
 * every shard drops a small `trimmed-ids-<shard>.json` marker listing the entry
 * ids it rewrote, and this script merges all of them in a single pass and then
 * deletes the markers.
 *
 * Usage: node scripts/bump-asset-versions.mjs [--dry-run]
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
  console.error("library/index.json not found; asset versions left unchanged.");
  process.exit(0);
}

// Collect the ids each shard recorded.
const ids = new Set();
const markers = fs
  .readdirSync(LIBRARY)
  .filter((n) => /^trimmed-ids-.*\.json$/.test(n));

for (const name of markers) {
  const full = path.join(LIBRARY, name);
  try {
    const list = JSON.parse(fs.readFileSync(full, "utf8"));
    if (!Array.isArray(list)) throw new Error("not an array");
    for (const id of list) if (typeof id === "string" && id) ids.add(id);
    console.error(`${name}: ${list.length} entr${list.length === 1 ? "y" : "ies"}.`);
  } catch (err) {
    console.error(`Skipping ${name}: ${String(err.message).slice(0, 120)}`);
  }
}

if (!ids.size) {
  console.error("No trimmed-ids markers found; nothing to bump.");
  // Still clean up stray empty markers so they cannot linger forever.
  if (!dryRun) for (const name of markers) fs.rmSync(path.join(LIBRARY, name), { force: true });
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

const stamp = new Date().toISOString();
let n = 0;
for (const e of entries) {
  if (!e || !ids.has(e.id)) continue;
  e.webmGeneratedAt = stamp;
  if (!e.posterGeneratedAt) e.posterGeneratedAt = stamp;
  n += 1;
}

const matched = ids.size;
if (!n) {
  // Markers referenced ids that are not in the index; drop them either way so
  // a later run cannot keep trying to bump entries that do not exist.
  console.error(`None of the ${matched} recorded ids matched an entry in library/index.json.`);
  if (!dryRun) for (const name of markers) fs.rmSync(path.join(LIBRARY, name), { force: true });
  process.exit(0);
}

console.error(`Bumping webmGeneratedAt to ${stamp} for ${n} of ${matched} recorded entr${matched === 1 ? "y" : "ies"}.`);
if (dryRun) process.exit(0);

fs.writeFileSync(INDEX, `${JSON.stringify(entries, null, 2)}\n`);
for (const name of markers) fs.rmSync(path.join(LIBRARY, name), { force: true });
console.error(`Rewrote library/index.json and removed ${markers.length} marker file${markers.length === 1 ? "" : "s"}.`);
