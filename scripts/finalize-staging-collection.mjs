#!/usr/bin/env node
/**
 * Разгружает папку набора: переносит её содержимое в постоянную сборку и
 * оставляет наборную папку пустой под новые работы.
 *
 * Нужно один раз, когда папка набора упёрлась в предел GitHub (1000 элементов).
 * Дальше ротацию ведёт rotate-library.mjs автоматически.
 *
 * Запуск: node scripts/finalize-staging-collection.mjs <приёмник> [--dry-run]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const STAGING = process.env.LIBRARY_STAGING_DIR || "library_02";
const target = process.argv[2];
const dryRun = process.argv.includes("--dry-run");
const BRANCH = process.env.GITHUB_BRANCH || "main";

function log(...a) { console.error(...a); }
if (!target) {
  log("Укажите папку-приёмник: node scripts/finalize-staging-collection.mjs library_01");
  process.exit(1);
}

const stagingDir = path.join(ROOT, STAGING);
if (!fs.existsSync(stagingDir)) {
  log(`Папка набора ${STAGING} не найдена.`);
  process.exit(0);
}

const entries = fs.readdirSync(stagingDir, { withFileTypes: true });
const workFolders = entries.filter((e) => e.isDirectory());
log(`В ${STAGING}: папок ${workFolders.length}, всего элементов ${entries.length}`);

if (!workFolders.length) {
  log("Переносить нечего.");
  process.exit(0);
}

fs.mkdirSync(path.join(ROOT, target), { recursive: true });
for (const dir of workFolders) {
  const from = `${STAGING}/${dir.name}`;
  const to = `${target}/${dir.name}`;
  log(`${from} -> ${to}`);
  if (!dryRun) execFileSync("git", ["mv", from, to], { cwd: ROOT, stdio: "pipe" });
}

// Index, metrics and the censorship lists describe every work, so they follow the
// works into the collection instead of staying behind on an empty staging folder.
for (const name of ["index.json", "metrics.json", "archive-exclusions.json", "censorship.json"]) {
  const from = `${STAGING}/${name}`;
  if (!fs.existsSync(path.join(ROOT, from))) continue;
  log(`${from} -> ${target}/${name}`);
  if (!dryRun) execFileSync("git", ["mv", from, `${target}/${name}`], { cwd: ROOT, stdio: "pipe" });
}

// The staging folder starts over: a bare index for the next uploads.
fs.writeFileSync(path.join(stagingDir, "index.json"), "[]", "utf8");
fs.writeFileSync(
  path.join(stagingDir, "README.md"),
  `# ${STAGING} — папка набора\n\nНовые работы попадают сюда. Когда папок станет 999, содержимое\nпереезжает в следующую постоянную сборку, а эта папка снова пустеет.\n`,
  "utf8",
);
log(`${STAGING} перезапущена пустой`);

if (dryRun) {
  log("dry-run: ничего не закоммичено");
  process.exit(0);
}

execFileSync("git", ["add", "-A", STAGING, target], { cwd: ROOT, stdio: "pipe" });
execFileSync(
  "git",
  ["-c", "user.name=github-actions[bot]", "-c", "user.email=41898282+github-actions[bot]@users.noreply.github.com",
   "commit", "-m", `Перенос ${STAGING} в постоянную сборку ${target}`],
  { cwd: ROOT, stdio: "pipe" },
);

for (let attempt = 1; attempt <= 8; attempt += 1) {
  try {
    execFileSync("git", ["push", "origin", `HEAD:${BRANCH}`], { cwd: ROOT, stdio: "pipe" });
    log(`Отправлено в ${BRANCH} (попытка ${attempt})`);
    process.exit(0);
  } catch {
    log(`push отклонён (попытка ${attempt}), пересобираем поверх origin/${BRANCH}`);
    execFileSync("git", ["fetch", "origin", BRANCH], { cwd: ROOT, stdio: "pipe" });
    execFileSync("git", ["reset", "--hard", `origin/${BRANCH}`], { cwd: ROOT, stdio: "pipe" });
  }
}
log("Не удалось отправить после 8 попыток");
process.exit(1);
