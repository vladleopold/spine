#!/usr/bin/env node
/** Возвращает префикс library_01 обратно в library во всех полях записей. */
import fs from "node:fs";
const file = process.argv[2] || "library/index.json";
if (!fs.existsSync(file)) { console.log(`нет ${file}`); process.exit(0); }
const entries = JSON.parse(fs.readFileSync(file, "utf8"));
let touched = 0;
for (const entry of entries) {
  let changed = false;
  for (const [key, value] of Object.entries(entry)) {
    if (typeof value !== "string" || !value.includes("/library_01/")) continue;
    entry[key] = value.split("/library_01/").join("/library/");
    changed = true;
  }
  if (typeof entry.previewPath === "string" && entry.previewPath.startsWith("library_01/")) {
    entry.previewPath = `library/${entry.previewPath.slice("library_01/".length)}`;
    changed = true;
  }
  if (changed) touched += 1;
}
fs.writeFileSync(file, `${JSON.stringify(entries, null, 2)}\n`, "utf8");
console.log(`обновлено записей: ${touched} из ${entries.length}`);
