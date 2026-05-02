import fs from "node:fs";
import { chromium } from "playwright";
import gifenc from "gifenc";

const { GIFEncoder, applyPalette, quantize } = gifenc;

function loadLocalEnv() {
  if (!fs.existsSync(".env.local")) return;
  for (const line of fs.readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
    if (!match) continue;
    process.env[match[1]] = match[2].replace(/^['"]|['"]$/g, "");
  }
}

function cleanRepoPath(value = "") {
  return String(value).trim().replace(/^\/+|\/+$/g, "").replace(/\/+/g, "/");
}

function joinRepoPath(...parts) {
  return parts.map(cleanRepoPath).filter(Boolean).join("/");
}

function encodeRepoPath(path) {
  return cleanRepoPath(path)
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function githubHeaders(token) {
  return {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${token}`,
    "X-GitHub-Api-Version": "2022-11-28",
  };
}

async function githubJson(settings, pathname, options = {}) {
  const response = await fetch(`https://api.github.com/repos/${settings.owner}/${settings.repo}${pathname}`, {
    ...options,
    headers: {
      ...githubHeaders(settings.token),
      ...(options.headers || {}),
    },
  });
  const text = await response.text();
  const data = text ? JSON.parse(text) : null;
  if (!response.ok) throw new Error(`${options.method || "GET"} ${pathname} failed: ${response.status} ${text}`);
  return data;
}

async function getContent(settings, path) {
  const encodedPath = encodeRepoPath(path);
  return githubJson(settings, `/contents/${encodedPath}?ref=${encodeURIComponent(settings.branch)}`);
}

async function putContent(settings, path, contentBase64, message, sha) {
  const encodedPath = encodeRepoPath(path);
  return githubJson(settings, `/contents/${encodedPath}`, {
    method: "PUT",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      message,
      content: contentBase64,
      branch: settings.branch,
      ...(sha ? { sha } : {}),
    }),
  });
}

async function getExistingSha(settings, path) {
  try {
    return (await getContent(settings, path)).sha || "";
  } catch {
    return "";
  }
}

function encodeGif(frames, width, height) {
  const gif = GIFEncoder({ initialCapacity: 256 * 1024 });
  for (const frame of frames) {
    const rgba = new Uint8ClampedArray(frame);
    const palette = quantize(rgba, 64, { format: "rgb444" });
    const index = applyPalette(rgba, palette, "rgb444");
    gif.writeFrame(index, width, height, { palette, delay: 120, repeat: 0 });
  }
  gif.finish();
  return Buffer.from(gif.bytes()).toString("base64");
}

async function captureFrames(page, previewUrl) {
  await page.goto(previewUrl, { waitUntil: "networkidle", timeout: 60_000 });
  await page.waitForFunction(
    () => Array.from(document.querySelectorAll("canvas")).some((canvas) => canvas.width > 100 && canvas.height > 100),
    { timeout: 40_000 },
  );
  await page.waitForTimeout(500);

  return page.evaluate(async () => {
    const width = 176;
    const height = 108;
    const frameCount = 6;
    const delay = 120;
    const sleep = (milliseconds) => new Promise((resolve) => window.setTimeout(resolve, milliseconds));
    const source = Array.from(document.querySelectorAll("canvas"))
      .filter((canvas) => canvas.width > 100 && canvas.height > 100)
      .sort((a, b) => b.width * b.height - a.width * a.height)[0];
    if (!source) return null;

    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d", { willReadFrequently: true });
    if (!context) return null;

    const scale = Math.min(width / source.width, height / source.height);
    const nextWidth = Math.max(1, Math.round(source.width * scale));
    const nextHeight = Math.max(1, Math.round(source.height * scale));
    const offsetX = Math.round((width - nextWidth) / 2);
    const offsetY = Math.round((height - nextHeight) / 2);
    const frames = [];

    for (let index = 0; index < frameCount; index += 1) {
      await sleep(index === 0 ? 120 : delay);
      context.fillStyle = "#050607";
      context.fillRect(0, 0, width, height);
      context.drawImage(source, offsetX, offsetY, nextWidth, nextHeight);
      frames.push(Array.from(context.getImageData(0, 0, width, height).data));
    }

    return { width, height, frames };
  });
}

loadLocalEnv();

const settings = {
  owner: process.env.GITHUB_OWNER || process.env.VITE_GITHUB_OWNER || "vladleopold",
  repo: process.env.GITHUB_REPO || process.env.VITE_GITHUB_REPO || "spine",
  branch: process.env.GITHUB_BRANCH || process.env.VITE_GITHUB_BRANCH || "main",
  basePath: process.env.GITHUB_BASE_PATH || process.env.VITE_GITHUB_BASE_PATH || "library",
  token: process.env.GITHUB_TOKEN,
};
const origin = process.env.SPINE_LINK_ORIGIN || "https://spine-link.vercel.app";
const limit = Number(process.env.BACKFILL_LIMIT || "0");

if (!settings.token) throw new Error("GITHUB_TOKEN is required");

const indexPath = joinRepoPath(settings.basePath, "index.json");
const indexContent = await getContent(settings, indexPath);
const entries = JSON.parse(Buffer.from(indexContent.content.replace(/\s/g, ""), "base64").toString("utf8"));
const candidates = entries.filter((entry) => entry?.id && entry.thumbnailType !== "gif");
const selected = limit > 0 ? candidates.slice(0, limit) : candidates;
console.log(`entries=${entries.length} candidates=${candidates.length} selected=${selected.length}`);

const browser = await chromium.launch({ headless: true });
let updated = 0;
try {
  const page = await browser.newPage({ viewport: { width: 960, height: 720 } });
  for (const entry of selected) {
    const previewUrl = `${origin}/p/${encodeURIComponent(String(entry.id))}`;
    const thumbnailPath = joinRepoPath(entry.previewPath || joinRepoPath(settings.basePath, entry.id), "thumbnail.gif");
    const thumbnailUrl = `${origin}/assets/${encodeRepoPath(thumbnailPath)}`;
    console.log(`capture ${entry.id}`);
    try {
      const result = await captureFrames(page, previewUrl);
      if (!result?.frames?.length) throw new Error("No canvas frames captured");
      const gifBase64 = encodeGif(result.frames, result.width, result.height);
      const existingSha = await getExistingSha(settings, thumbnailPath);
      await putContent(settings, thumbnailPath, gifBase64, `Add GIF thumbnail ${entry.title || entry.id}`, existingSha);
      entry.thumbnail = thumbnailUrl;
      entry.thumbnailType = "gif";
      updated += 1;
      console.log(`updated ${entry.id} ${Math.round((gifBase64.length * 3) / 4 / 1024)} KiB`);
    } catch (error) {
      console.warn(`skip ${entry.id}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
} finally {
  await browser.close();
}

if (updated > 0) {
  const latestIndex = await getContent(settings, indexPath);
  await putContent(
    settings,
    indexPath,
    Buffer.from(JSON.stringify(entries, null, 2)).toString("base64"),
    `Backfill ${updated} GIF library thumbnails`,
    latestIndex.sha,
  );
}

console.log(`done updated=${updated}`);
