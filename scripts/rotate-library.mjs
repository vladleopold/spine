#!/usr/bin/env node
/**
 * Ротация папок библиотеки.
 *
 * Пока в папке набора меньше предела, ничего не происходит. Как только папок
 * стало 999, создаётся следующая постоянная сборка (library_03, library_04, ...),
 * папка набора остаётся пустой под новые работы, а её содержимое переезжает
 * в новую сборку вместе с README, где фиксируется период сборки.
 *
 * Загрузки всегда идут в текущую папку набора, поэтому сайт продолжает видеть
 * работы: он читает index.json каждой сборки.
 *
 * Запуск: node scripts/rotate-library.mjs [--dry-run]
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync } from "node:child_process";

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
// The collection that receives new uploads. It rotates on its own: once it holds
// MAX_FOLDERS works they move into the next permanent library_NN collection.
// `library` itself became the first permanent collection, kept under its original
// name so no work loses its path.
// Uploads land in the highest-numbered library_NN folder. Once it holds
// MAX_FOLDERS works it becomes a permanent collection and the next number opens,
// so the repository grows as many folders as it needs.
const PREFIX = "library_";
const MAX_FOLDERS = 999;
const dryRun = process.argv.includes("--dry-run");

const REPO = process.env.GITHUB_REPOSITORY || "vladleopold/spine";
const TOKEN = process.env.GITHUB_TOKEN || process.env.GH_TOKEN || "";
const BRANCH = process.env.GITHUB_BRANCH || "main";

function log(...args) {
  console.error(...args);
}

if (!TOKEN) {
  log("GITHUB_TOKEN is not set.");
  process.exit(1);
}

async function api(pathname, options = {}) {
  const response = await fetch(`https://api.github.com/repos/${REPO}${pathname}`, {
    ...options,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${TOKEN}`,
      "User-Agent": "spine-link-library-rotate",
      ...(options.headers || {}),
    },
  });
  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(`${options.method || "GET"} ${pathname} -> ${response.status} ${text.slice(0, 200)}`);
  }
  return response.status === 204 ? null : response.json();
}

/** Every collection folder is exactly <name>-<ISO timestamp>; nothing else counts. */
function isEntryFolder(name) {
  return /-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/.test(name);
}

async function listFolder(dir) {
  let items = [];
  for (let page = 1; page <= 20; page += 1) {
    const batch = await api(`/contents/${dir}?ref=${BRANCH}&per_page=1000&page=${page}`);
    if (!Array.isArray(batch) || batch.length === 0) break;
    items = items.concat(batch);
    if (batch.length < 1000) break;
  }
  return items;
}

/** Highest collection index whose folder already exists: library_02 -> 2. */
async function highestCollection() {
  const items = await listFolder("");
  const indexes = items
    .map((item) => (item.type === "dir" ? item.name.match(new RegExp(`^${PREFIX}(\\d+)$`)) : null))
    .filter(Boolean)
    .map((match) => Number(match[1]));
  // The original `library` folder is collection #1: it is frozen and only read.
  if (items.some((item) => item.type === "dir" && item.name === "library")) indexes.push(1);
  return indexes.length ? Math.max(...indexes) : 0;
}

/**
 * The folder that receives new uploads: the highest-numbered collection that
 * actually holds works, which is what an upload can be routed to. Empty
 * placeholder folders carry no index.json and are skipped, so a rotation that
 * created `library_90` but never filled it does not strand new uploads there.
 */
async function activeStagingCollection() {
  const items = await listFolder("");
  const numbered = items
    .map((item) => (item.type === "dir" ? item.name.match(new RegExp(`^${PREFIX}(\\d+)$`)) : null))
    .filter(Boolean)
    .map((match) => ({ name: match[0], index: Number(match[1]) }))
    .sort((a, b) => b.index - a.index);
  for (const { name } of numbered) {
    const contents = await listFolder(name);
    const hasIndex = contents.some((item) => item.name === "index.json");
    if (hasIndex) return { name, index: numbered.find((x) => x.name === name).index };
  }
  return null;
}

function monthOf(id) {
  const match = String(id || "").match(/(\d{4})-(\d{2})/);
  return match ? `${match[1]}-${match[2]}` : "";
}

function readme({ collection, entries, first, last }) {
  const months = new Map();
  for (const name of entries) {
    const month = monthOf(name) || "неи��вестно";
    months.set(month, (months.get(month) || 0) + 1);
  }
  const rows = [...months.entries()].sort().map(([month, count]) => `| ${month} | ${count} |`).join("\n");
  return `# ${collection} — сборка Spine-анимаций

> Постоянная папка сбора. Работы сюда не добавляются: сборка закрыта и только
> читается сайтом. Новые работы идут в текущую папку набора и переезжают в
> следующую сборку при ротации.

## Период сборки

| | |
|---|---|
| **Начало** | ${first || "неизвестно"} |
| **Конец** | ${last || "неизвестно"} |
| **Работ в сборке** | ${entries.length} |
| **Предел папки** | ${MAX_FOLDERS} |

## Состав по месяцам

| Месяц | Работ |
| --- | --- |
${rows || "| — | 0 |"}

## Структура

\`\`\`
${collection}/
├── README.md        ← этот файл
├── index.json       ← список всех работ сборки
├── metrics.json     ← лайки и просмотры
└── <работа--id>/     ← папка одной работы: скелет, атлас, текстура, видео
\`\`\`

## Карточка работы

Каждая работа — отдельная папка с именем \`<название>-<дата загрузки>\`, внутри:

- \`*.json\` или \`*.skel\` — скелет Spine
- \`*.atlas\` + текстура
- \`preview.webm\` — превью-видео анимации
- \`*-preview.webp\` — постер для карточки

## Как пользоваться

Публичная витрина: \`https://spine-link.vercel.app/world-spine-archive\`
Страница отдельной работы: \`https://spine-link.vercel.app/p/<работа-id>\`

---

Сборка закрыта ротацией ${MAX_FOLDERS} папок. Состав зафиксирован автоматически.
`;
}

// The checkout already contains the whole tree, so a plain `git mv` relocates a
// work folder in one commit instead of thousands of Contents API round trips.
async function moveEntry(fromName, toCollection, stagingName) {
  const from = `${stagingName}/${fromName}`;
  const to = `${toCollection}/${fromName}`;
  if (dryRun) {
    log(`  [dry-run] ${from} -> ${to}`);
    return;
  }
  fs.mkdirSync(path.join(ROOT, toCollection), { recursive: true });
  execFileSync("git", ["mv", from, to], { cwd: ROOT, stdio: "pipe" });
  log(`  ${fromName} -> ${toCollection}`);
}

/** Writes a file only when it is missing, so a re-run never clobbers data. */
function writeIfAbsent(target, contents) {
  if (fs.existsSync(target)) return;
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.writeFileSync(target, contents, "utf8");
}

async function main() {
  const active = await activeStagingCollection();
  if (!active) {
    log("Активная папка набора не найдена: ротация не нужна.");
    return;
  }
  const stagingName = active.name;
  const staging = await listFolder(stagingName);
  const entries = staging.filter((item) => item.type === "dir" && isEntryFolder(item.name)).map((item) => item.name);

  log(`Папка набора ${stagingName}: папок ${entries.length} (предел ${MAX_FOLDERS})`);

  if (entries.length < MAX_FOLDERS) {
    log("Ротация не нужна.");
    return;
  }

  // The folder we just filled becomes permanent; the next number is the new
  // staging folder that receives uploads from now on. The number comes from the
  // highest folder that exists, not from the active one, so empty placeholders
  // left by earlier runs are reused instead of skipped forever.
  const filled = stagingName;
  const highest = await highestCollection();
  const nextIndex = Math.max(highest, active.index) + 1;
  const next = `${PREFIX}${String(nextIndex).padStart(2, "0")}`;
  log(`Ротация: ${filled} переполнена (${entries.length}), становится постоянной; наборная папка — ${next}`);

  if (!dryRun) {
    await api(`/contents/${next}/index.json`, {
      method: "PUT",
      body: JSON.stringify({
        message: `Создание сборки ${next}`,
        content: Buffer.from("[]").toString("base64"),
        committer: { name: "github-actions[bot]", email: "41898282+github-actions[bot]@users.noreply.github.com" },
        author: { name: "github-actions[bot]", email: "41898282+github-actions[bot]@users.noreply.github.com" },
      }),
    });
    await api(`/contents/${next}/metrics.json`, {
      method: "PUT",
      body: JSON.stringify({
        message: `Создание сборки ${next}`,
        content: Buffer.from(JSON.stringify({ likes: {}, views: {} })).toString("base64"),
        committer: { name: "github-actions[bot]", email: "41898282+github-actions[bot]@users.noreply.github.com" },
        author: { name: "github-actions[bot]", email: "41898282+github-actions[bot]@users.noreply.github.com" },
      }),
    });
    log(`Создана папка ${next}`);
  }

  const ordered = [...entries].sort();
  for (const name of ordered) await moveEntry(name, next, stagingName);

  const first = monthOf(ordered[0]);
  const last = monthOf(ordered[ordered.length - 1]);
  const readmeBody = Buffer.from(readme({ collection: next, entries: ordered, first, last })).toString("base64");
  if (dryRun) {
    log("  [dry-run] README для", next);
  } else {
    fs.writeFileSync(path.join(ROOT, next, "README.md"), readme({ collection: next, entries: ordered, first, last }), "utf8");
    log(`Записан README сборки ${next}`);
  }

  if (dryRun) return;

  // One commit for the whole rotation: 999 renames would be unreadable otherwise.
  // Keep the filled folder in the tree with an empty index so GitHub keeps it
  // around; the new staging folder needs a README-less placeholder for the same
  // reason. Both are staged explicitly rather than via git add -A, because the
  // checkout also carries build output.
  writeIfAbsent(path.join(ROOT, filled, "index.json"), "[]");
  execFileSync("git", ["add", "-A", filled, next], { cwd: ROOT, stdio: "pipe" });
  execFileSync(
    "git",
    [
      "-c", "user.name=github-actions[bot]",
      "-c", "user.email=41898282+github-actions[bot]@users.noreply.github.com",
      "commit", "-m",
      `Ротация библиотеки: ${ordered.length} работ перенесены в ${next}`,
    ],
    { cwd: ROOT, stdio: "pipe" },
  );

  // The 20 MB index has to move too; retry on the pushes that lose a race.
  for (let attempt = 1; attempt <= 8; attempt += 1) {
    try {
      execFileSync("git", ["push", "origin", "HEAD:${BRANCH}"], { cwd: ROOT, stdio: "pipe" });
      log(`Ротация отправлена в ${BRANCH} (попытка ${attempt})`);
      return;
    } catch {
      log(`  push отклонён (попытка ${attempt}), пересобираем поверх origin/${BRANCH}`);
      execFileSync("git", ["fetch", "origin", BRANCH], { cwd: ROOT, stdio: "pipe" });
      execFileSync("git", ["reset", "--hard", `origin/${BRANCH}`], { cwd: ROOT, stdio: "pipe" });
    }
  }
  throw new Error("Не удалось отправить ротацию после 8 попыток");
}

main().catch((error) => {
  log("Ротация не выполнена:", error.message);
  process.exit(1);
});
