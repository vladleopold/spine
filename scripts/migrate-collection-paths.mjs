#!/usr/bin/env node
/**
 * Переписывает пути внутри записей после переименования папки набора.
 *
 * `library` стал `library_01`, поэтому старые ссылки вида library/<работа>
 * больше не ведут к файлам. Заменяем префикс во всех полях, где встречается
 * путь, и не трогаем ничего, что не является путём этой библиотеки.
 *
 * Запуск: node scripts/migrate-collection-paths.mjs <старое> <новое> [--dry-run]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const [from, to] = process.argv.slice(2).filter((a) => !a.startsWith("--"));
const dryRun = process.argv.includes("--dry-run");
const BRANCH = process.env.GITHUB_BRANCH || "main";

if (!from || !to) {
  console.error("Использование: node scripts/migrate-collection-paths.mjs library library_01");
  process.exit(1);
}

const indexPath = path.join(ROOT, to, "index.json");
if (!fs.existsSync(indexPath)) {
  console.error(`${to}/index.json не найден.`);
  process.exit(1);
}

const entries = JSON.parse(fs.readFileSync(indexPath, "utf8"));
const fromSegment = `/${from}/`;
const fromPrefix = `${from}/`;
let touched = 0;

for (const entry of entries) {
  let changed = false;
  for (const [key, value] of Object.entries(entry)) {
    if (typeof value !== "string" || !value.includes(fromSegment)) continue;
    // Only the collection path changes; the work folder inside stays the same.
    entry[key] = value.split(fromSegment).join(`/${to}/`);
    changed = true;
  }
  if (typeof entry.previewPath === "string" && entry.previewPath.startsWith(fromPrefix)) {
    entry.previewPath = `${to}/${entry.previewPath.slice(fromPrefix.length)}`;
    changed = true;
  }
  if (changed) touched += 1;
}

console.error(`Обновлено записей: ${touched} из ${entries.length}`);
if (dryRun) {
  console.error("dry-run: файл не записан");
  process.exit(0);
}

fs.writeFileSync(indexPath, `${JSON.stringify(entries, null, 2)}\n`, "utf8");
execFileSync("git", ["add", to], { cwd: ROOT, stdio: "pipe" });
execFileSync(
  "git",
  ["-c", "user.name=github-actions[bot]", "-c", "user.email=41898282+github-actions[bot]@users.noreply.github.com",
   "commit", "-m", `Миграция путей ${from} -> ${to} в индексе`],
  { cwd: ROOT, stdio: "pipe" },
);
for (let attempt = 1; attempt <= 8; attempt += 1) {
  try {
    execFileSync("git", ["push", "origin", `HEAD:${BRANCH}`], { cwd: ROOT, stdio: "pipe" });
    console.error(`Отправлено в ${BRANCH} (попытка ${attempt})`);
    process.exit(0);
  } catch {
    console.error(`push отклонён (попытка ${attempt})`);
    execFileSync("git", ["fetch", "origin", BRANCH], { cwd: ROOT, stdio: "pipe" });
    execFileSync("git", ["reset", "--hard", `origin/${BRANCH}`], { cwd: ROOT, stdio: "pipe" });
  }
}
console.error("Не удалось отправить после 8 попыток");
process.exit(1);
