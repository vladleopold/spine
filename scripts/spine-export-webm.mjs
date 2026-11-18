#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { chooseAtlasForSkeleton, reconcileDdsAtlasPages } from "./atlas-pages.mjs";
import { shouldUseCanvasFallback, fallbackFrameCount } from "./lib/canvas-fallback.mjs";
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { trimBlackLead } from './lib/black-lead.mjs';
import { collectionPathForUpload, entryForUpload } from './resolve-library.mjs';
import { detectSkeletonVersion } from './spine-version-detect.mjs';

const args = {
  uploadId: '',
  origin: 'https://spine-link.vercel.app',
  animation: '',
  defaultAnimation: '',
  output: '',
  repoPath: '.',
  basePath: 'library',
  owner: 'vladleopold',
  repo: 'spine',
  branch: 'main',
  githubToken: '',
  sanitizeSkel: false,
  fps: 30,
  alpha: false,
};

for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg === '--alpha') args.alpha = true;
  else if (arg.startsWith('--fps=')) args.fps = Number(arg.slice(arg.indexOf('=') + 1));
  else if (arg.startsWith('--upload-id=')) args.uploadId = arg.slice(arg.indexOf('=') + 1);
  else if (arg.startsWith('--origin=')) args.origin = arg.slice(arg.indexOf('=') + 1);
  else if (arg.startsWith('--animation=')) args.animation = arg.slice(arg.indexOf('=') + 1);
  else if (arg.startsWith('--default-animation=')) args.defaultAnimation = arg.slice(arg.indexOf('=') + 1);
  else if (arg.startsWith('--output=')) args.output = arg.slice(arg.indexOf('=') + 1);
  else if (arg.startsWith('--repo-path=')) args.repoPath = arg.slice(arg.indexOf('=') + 1);
  else if (arg.startsWith('--base-path=')) args.basePath = arg.slice(arg.indexOf('=') + 1);
  else if (arg.startsWith('--owner=')) args.owner = arg.slice(arg.indexOf('=') + 1);
  else if (arg.startsWith('--repo=')) args.repo = arg.slice(arg.indexOf('=') + 1);
  else if (arg.startsWith('--github-token=')) args.githubToken = arg.slice(arg.indexOf('=') + 1);
  else if (arg.startsWith('--sanitize-skel=')) args.sanitizeSkel = arg.slice(arg.indexOf('=') + 1) !== 'false';
}

if (![30, 60, 90, 120, 190, 300].includes(args.fps)) throw new Error('Unsupported FPS; use 30,60,90,120,190,300');

if (!args.uploadId) {
  console.error('Usage: spine-export-webm.mjs --upload-id=<id> --animation=<name> [options]');
  process.exit(1);
}

const repoRoot = path.resolve(args.repoPath);

// The work may sit in any library_NN collection, and the active one moves as the
// library rotates, so the folder is looked up by upload id instead of being
// assumed from --base-path. The flag stays as an override and a last resort.
const found = entryForUpload(repoRoot, args.uploadId);
const basePath = found ? found.basePath : collectionPathForUpload(repoRoot, args.uploadId, args.basePath);
const indexPath = path.join(repoRoot, basePath, 'index.json');
if (!fs.existsSync(indexPath)) {
  console.error(`Index not found at ${indexPath}`);
  process.exit(1);
}

const indexEntries = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
const entry = found ? found.entry : indexEntries.find(e => e.id === args.uploadId);
if (!entry) {
  console.error(`Entry ${args.uploadId} not found in index`);
  process.exit(1);
}

console.log(`Collection folder for ${args.uploadId}: ${basePath}`);

const uploadPath = entry.previewPath || path.posix.join(basePath, args.uploadId);

function findSetDirectories(baseDir, depth = 0) {
  if (depth > 6 || !fs.existsSync(baseDir)) return [];
  const entries = fs.readdirSync(baseDir, { withFileTypes: true });
  const files = entries.filter(e => e.isFile()).map(e => e.name);
  const skeletons = files.filter(f => /\.(json|skel)$/i.test(f));
  const validSkeleton = skeletons.some(f => {
    if (/\.skel$/i.test(f)) return true;
    try { return Array.isArray(JSON.parse(fs.readFileSync(path.join(baseDir, f), 'utf8')).bones); } catch { return false; }
  });
  if (validSkeleton && files.some(f => /\.atlas(?:\.txt|\.docx)?$/i.test(f)) && files.some(f => /\.(png|jpe?g|webp)$/i.test(f))) {
    return [{ name: path.basename(baseDir), path: baseDir }];
  }
  return entries.filter(e => e.isDirectory() && !e.name.endsWith('.__chunks') && e.name !== 'animations')
    .flatMap(e => findSetDirectories(path.join(baseDir, e.name), depth + 1));
}

const previewDir = path.join(repoRoot, uploadPath);
const sets = findSetDirectories(previewDir);

if (sets.length === 0) {
  console.error(`No Spine sets found in ${previewDir}`);
  process.exit(1);
}

const firstSet = sets[0];
const setFiles = fs.readdirSync(firstSet.path);
const skeletonFile = setFiles.find(f => /\.json$/i.test(f) && (() => { try { return Array.isArray(JSON.parse(fs.readFileSync(path.join(firstSet.path, f), 'utf8')).bones); } catch { return false; } })()) || setFiles.find(f => /\.skel$/i.test(f));
// A project may include several atlases (e.g. its skeleton and an unrelated
// character). Taking the first atlas breaks valid animations and preview jobs.
const atlasFile = chooseAtlasForSkeleton(skeletonFile, setFiles);
const textureFiles = setFiles.filter(f => /\.(png|jpg|jpeg|webp)$/i.test(f));

if (!skeletonFile || !atlasFile || textureFiles.length === 0) {
  console.error(`Set ${firstSet.name} is missing required files`);
  process.exit(1);
}

/**
 * Read skeleton bounding box (width/height) from the skeleton file.
 * JSON skeletons store bounds in skeleton.width / skeleton.height.
 * Binary .skel files: we attempt a best-effort parse of the header.
 * Returns { width, height } or { width: 0, height: 0 } if unreadable.
 */
function readSkeletonBounds(filePath) {
  try {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.json') {
      const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      const w = Number(content?.skeleton?.width) || 0;
      const h = Number(content?.skeleton?.height) || 0;
      return { width: w, height: h };
    }
    if (ext === '.skel') {
      const dir = path.dirname(filePath);
      const base = path.basename(filePath, '.skel');
      const jsonSibling = path.join(dir, base + '.json');
      if (fs.existsSync(jsonSibling)) {
        const content = JSON.parse(fs.readFileSync(jsonSibling, 'utf8'));
        const w = Number(content?.skeleton?.width) || 0;
        const h = Number(content?.skeleton?.height) || 0;
        return { width: w, height: h };
      }
      return { width: 0, height: 0 };
    }
  } catch { }
  return { width: 0, height: 0 };
}

function readAnimationNames(filePath) {
  try {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.json') {
      const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return Object.keys(content?.animations || {});
    }
    if (ext === '.skel') {
      const dir = path.dirname(filePath);
      const base = path.basename(filePath, '.skel');
      const jsonSibling = path.join(dir, base + '.json');
      if (fs.existsSync(jsonSibling)) {
        const content = JSON.parse(fs.readFileSync(jsonSibling, 'utf8'));
        return Object.keys(content?.animations || {});
      }
    }
  } catch { }
  return [];
}

/**
 * Read skin names from a JSON skeleton file. The Spine player renders the
 * 'default' skin when no skin is requested, but some skeletons keep their
 * visible attachments on a named skin only (default renders nothing but the
 * background). Returns [] for binary .skel files or unreadable data.
 */
function readSkinNames(filePath) {
  try {
    const tryParse = (p) => {
      const content = JSON.parse(fs.readFileSync(p, 'utf8'));
      const skins = content?.skins;
      if (Array.isArray(skins)) return skins.map((s) => s && s.name).filter(Boolean);
      if (skins && typeof skins === 'object') return Object.keys(skins);
      return [];
    };
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.json') return tryParse(filePath);
    if (ext === '.skel') {
      const dir = path.dirname(filePath);
      const base = path.basename(filePath, '.skel');
      const jsonSibling = path.join(dir, base + '.json');
      if (fs.existsSync(jsonSibling)) return tryParse(jsonSibling);
    }
  } catch { }
  return [];
}

/**
 * Compute animation duration from JSON skeleton timeline data as a fallback
 * when the player reports duration=0 (Spine 4.2.x JSON exports sometimes
 * omit the top-level 'duration' field on animations).
 * Walks all timeline keys for the given animation and returns the max 'time'.
 */
function readJsonAnimationDuration(filePath, animationName) {
  try {
    const ext = path.extname(filePath).toLowerCase();
    let content = null;
    if (ext === '.json') {
      content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
    } else if (ext === '.skel') {
      const dir = path.dirname(filePath);
      const base = path.basename(filePath, '.skel');
      const jsonSibling = path.join(dir, base + '.json');
      if (fs.existsSync(jsonSibling)) {
        content = JSON.parse(fs.readFileSync(jsonSibling, 'utf8'));
      }
    }
    if (!content || !content.animations || !content.animations[animationName]) return 0;
    const anim = content.animations[animationName];
    let maxTime = 0;
    const collect = (obj) => {
      if (!obj) return;
      if (Array.isArray(obj)) {
        for (const v of obj) {
          if (v && typeof v === 'object' && 'time' in v && typeof v.time === 'number') {
            if (v.time > maxTime) maxTime = v.time;
          }
        }
        return;
      }
      if (typeof obj !== 'object') return;
      for (const k of Object.keys(obj)) collect(obj[k]);
    };
    collect(anim);
    return maxTime;
  } catch { }
  return 0;
}

class SpineBinaryCursor {
  constructor(bytes) {
    this.bytes = bytes;
    this.index = 0;
  }
  readByte() { return this.bytes[this.index++] ?? 0; }
  skip(length) { this.index += length; }
  readInt(optimizePositive) {
    let byte = this.readByte();
    let result = byte & 0x7f;
    if ((byte & 0x80) !== 0) {
      byte = this.readByte(); result |= (byte & 0x7f) << 7;
      if ((byte & 0x80) !== 0) {
        byte = this.readByte(); result |= (byte & 0x7f) << 14;
        if ((byte & 0x80) !== 0) {
          byte = this.readByte(); result |= (byte & 0x7f) << 21;
          if ((byte & 0x80) !== 0) {
            byte = this.readByte(); result |= (byte & 0x7f) << 28;
          }
        }
      }
    }
    return optimizePositive ? result : (result >>> 1) ^ -(result & 1);
  }
  readStringMeta() {
    const start = this.index;
    const byteCount = this.readInt(true);
    const contentStart = this.index;
    if (byteCount === 0) return { start, end: this.index, value: null };
    if (byteCount === 1) return { start, end: this.index, value: "" };
    this.skip(byteCount - 1);
    return {
      start, end: this.index,
      value: new TextDecoder().decode(this.bytes.slice(contentStart, this.index)),
    };
  }
}

function encodeSpineBinaryString(value) {
  const textBytes = new TextEncoder().encode(value);
  const byteCount = textBytes.length + 1;
  const lengthBytes = [];
  let remaining = byteCount;
  while (true) {
    let byte = remaining & 0x7f;
    remaining >>>= 7;
    if (remaining) byte |= 0x80;
    lengthBytes.push(byte);
    if (!remaining) break;
  }
  return new Uint8Array([...lengthBytes, ...textBytes]);
}

function replaceByteRanges(bytes, replacements) {
  if (!replacements.length) return bytes;
  const sorted = [...replacements].sort((a, b) => a.start - b.start);
  const nextLength = sorted.reduce((length, replacement) => length - (replacement.end - replacement.start) + replacement.bytes.length, bytes.length);
  if (nextLength < 0) return bytes;
  const nextBytes = new Uint8Array(nextLength);
  let sourceIndex = 0, targetIndex = 0;
  for (const replacement of sorted) {
    const prefix = bytes.slice(sourceIndex, replacement.start);
    if (targetIndex + prefix.length > nextLength) return bytes;
    nextBytes.set(prefix, targetIndex);
    targetIndex += prefix.length;
    if (targetIndex + replacement.bytes.length > nextLength) return bytes;
    nextBytes.set(replacement.bytes, targetIndex);
    targetIndex += replacement.bytes.length;
    sourceIndex = replacement.end;
  }
  const tail = bytes.slice(sourceIndex);
  if (targetIndex + tail.length > nextLength) return bytes;
  nextBytes.set(tail, targetIndex);
  return nextBytes;
}

function sanitizedSkelBuffer(buffer, version = "") {
  const bytes = new Uint8Array(buffer);
  
  if (/^3\./.test(version)) {
    const patchCursor = new SpineBinaryCursor(new Uint8Array(bytes));
    try {
      patchCursor.readStringMeta();
      patchCursor.readStringMeta();
      patchCursor.skip(8);
      const nonessential = patchCursor.readByte() !== 0;
      if (nonessential) {
        patchCursor.skip(4);
        const imagesPathPos = patchCursor.index;
        if (bytes[imagesPathPos] === 0x00) bytes[imagesPathPos] = 0x01;
        patchCursor.readStringMeta();
        const audioPathPos = patchCursor.index;
        if (bytes[audioPathPos] === 0x00) bytes[audioPathPos] = 0x01;
      }
    } catch {}
  }

  const cursor = new SpineBinaryCursor(bytes);
  const replacements = [];
  try {
    if (/^3\./.test(version)) {
      cursor.readStringMeta(); cursor.readStringMeta();
      cursor.skip(8);
    } else {
      cursor.skip(8); cursor.readStringMeta(); cursor.skip(4);
      cursor.skip(16);
    }
    const nonessential = cursor.readByte() !== 0;
    if (nonessential) {
      cursor.skip(4); cursor.readStringMeta(); cursor.readStringMeta();
    }

    const stringCount = cursor.readInt(true);
    for (let index = 0; index < stringCount; index += 1) {
      const stringStart = cursor.index;
      const stringMeta = cursor.readStringMeta();
      if (stringMeta.value === null) {
        replacements.push({
          start: stringStart, end: stringMeta.end,
          bytes: encodeSpineBinaryString(''),
        });
      }
    }

    const boneCount = cursor.readInt(true);
    for (let index = 0; index < boneCount; index += 1) {
      const name = cursor.readStringMeta();
      if (!name.value) {
        replacements.push({
          start: name.start, end: name.end,
          bytes: encodeSpineBinaryString(`__placeholder_bone_${index}`),
        });
      }
      if (index > 0) cursor.readInt(true);
      cursor.skip(32); cursor.readInt(true); cursor.skip(1);
      if (nonessential) cursor.skip(4);
    }
    return Buffer.from(replaceByteRanges(bytes, replacements));
  } catch {
    return Buffer.from(bytes);
  }
}

const skeletonFilePath = path.join(firstSet.path, skeletonFile);
const skeletonVersion = detectSkeletonVersion(skeletonFilePath);
const skeletonBounds = readSkeletonBounds(skeletonFilePath);
let targetAnimation = args.animation || entry.defaultAnimation || '';
const availableAnimations = readAnimationNames(skeletonFilePath);
if (availableAnimations.length > 0) {
  if (!targetAnimation || !availableAnimations.includes(targetAnimation)) {
    targetAnimation = availableAnimations[0] || '';
  }
}

// --- Calculate dynamic video dimensions from skeleton bounds ---
const PAD_RATIO = 0.14; // 14% padding on each side
const MIN_VIDEO_DIM = 200;
const MAX_VIDEO_DIM = 1920;

// Huge skeleton bounds commonly include off-camera game assets. Preserve a
// native 1:1 game-camera crop instead of zooming out to show every attachment.
// Override per upload with --game-camera=WIDTHxHEIGHT when the game uses a
// different logical viewport. The camera is centered on the Spine origin.
const cameraFlag = process.argv.find(arg => arg.startsWith('--game-camera='));
const cameraMatch = cameraFlag?.split('=')[1]?.match(/^(\\d+)x(\\d+)$/i);
const gameCameraWidth = cameraMatch ? Math.min(3840, Math.max(320, Number(cameraMatch[1]))) : 1920;
const gameCameraHeight = cameraMatch ? Math.min(2160, Math.max(240, Number(cameraMatch[2]))) : 1080;
const hugeScene = skeletonBounds.width > gameCameraWidth * 1.5 ||
  skeletonBounds.height > gameCameraHeight * 1.5;
if (hugeScene) console.error(`Huge game scene: ${skeletonBounds.width}x${skeletonBounds.height}; capturing ${gameCameraWidth}x${gameCameraHeight} camera at native scale, not off-screen content`);

const rawSkelWidth = skeletonBounds.width;
const rawSkelHeight = skeletonBounds.height;

// Add padding to skeleton bounds; fall back to 960x720 if bounds unknown
const rawVideoWidth = rawSkelWidth > 0 ? rawSkelWidth * (1 + PAD_RATIO * 2) : 960;
const rawVideoHeight = rawSkelHeight > 0 ? rawSkelHeight * (1 + PAD_RATIO * 2) : 720;

// Clamp to min/max and ensure even dimensions (required by video codecs)
const videoWidth = hugeScene ? (gameCameraWidth & ~1) : (Math.min(MAX_VIDEO_DIM, Math.max(MIN_VIDEO_DIM, Math.round(rawVideoWidth))) & ~1) || 960;
const videoHeight = hugeScene ? (gameCameraHeight & ~1) : (Math.min(MAX_VIDEO_DIM, Math.max(MIN_VIDEO_DIM, Math.round(rawVideoHeight))) & ~1) || 720;

const versionMajor = skeletonVersion.split('.')[0] || '4';
const isLegacy = parseInt(versionMajor, 10) < 4;
const runtimeMinor = isLegacy ? (skeletonVersion.split('.')[1] || '8') : '';
const modernRuntime = /^4\.[012](?:\.|$)/.test(skeletonVersion) ? skeletonVersion.slice(0,3) : '4.3';
// Spine Player 4.0/4.1 consumes jsonUrl/binaryUrl + atlasUrl. The modern
// skeleton/atlas keys were introduced later; passing them leaves a blank canvas.
const oldPlayerConfig = isLegacy || modernRuntime === '4.0' || modernRuntime === '4.1';
const skeletonPlayerKey = isLegacy ? (skeletonFile.endsWith('.skel') ? 'skelUrl' : 'jsonUrl')
  : oldPlayerConfig ? (skeletonFile.endsWith('.skel') ? 'binaryUrl' : 'jsonUrl') : 'skeleton';
const atlasPlayerKey = oldPlayerConfig ? 'atlasUrl' : 'atlas';

// Use reliable Vercel domain for legacy player assets to avoid DNS resolution issues in GitHub Actions
const stableOrigin = 'https://spine-link.vercel.app';
const playerJsUrl = isLegacy
  ? `${stableOrigin}/vendor-spine-player-${versionMajor}.${runtimeMinor}.js`
  : modernRuntime === '4.3' ? 'https://cdn.jsdelivr.net/npm/@esotericsoftware/spine-player@4.3.13/dist/iife/spine-player.js'
    : `https://unpkg.com/@esotericsoftware/spine-player@${modernRuntime}.*/dist/iife/spine-player.js`;
const playerCssUrl = isLegacy
  ? `${stableOrigin}/vendor-spine-player-${versionMajor}.${runtimeMinor}.css`
  : modernRuntime === '4.3' ? 'https://cdn.jsdelivr.net/npm/@esotericsoftware/spine-player@4.3.13/dist/spine-player.css'
    : `https://unpkg.com/@esotericsoftware/spine-player@${modernRuntime}.*/dist/spine-player.css`;

const skeletonKey = skeletonFile.toLowerCase().endsWith('.skel') ? 'skelUrl' : 'skeleton';
const atlasKey = 'atlas';

const setSegments = [path.relative(repoRoot, firstSet.path).split(path.sep).join('/')];

function rawUrl(filename) {
  return `https://raw.githubusercontent.com/${args.owner}/${args.repo}/${args.branch}/${setSegments.join('/')}/${encodeURIComponent(filename)}`;
}

const skeletonRawUrl = rawUrl(skeletonFile);
const atlasRawUrl = rawUrl(atlasFile);
const textureRawUrls = textureFiles.map(f => rawUrl(f));

async function warmUpAnimations() {
  const skelUrl = skeletonKey === 'skelUrl' ? skeletonRawUrl : skeletonRawUrl;
  const atlasUrl = atlasRawUrl;
  const texUrls = JSON.stringify(textureRawUrls);
  const legacy = isLegacy;
  const skelKey = skeletonKey;
  const aKey = atlasKey;

  const page = await browser.newPage();
  try {
    const warmupHtml = `<!DOCTYPE html><html><head><meta charset="UTF-8"><link rel="stylesheet" href="${playerCssUrl}"><style>*{margin:0;padding:0;box-sizing:border-box}html,body{width:100%;height:100%;background:transparent;overflow:hidden}#player{width:100%;height:100%}</style></head><body><div id="player"></div><script src="${playerJsUrl}"></script><script>(function(){window.__warmup=null;var cfg={${skeletonPlayerKey}: '${skeletonRawUrl}',${atlasPlayerKey}: '${atlasRawUrl}',textures:${texUrls},showLoading:false,premultipliedAlpha:false,preserveDrawingBuffer:true,alpha:true,backgroundColor:'#00000000',success:function(p){window.__warmup=p;},error:function(p,e){window.__warmupError=e;}};try{if(typeof spine.SpinePlayer==='function'){new spine.SpinePlayer('player',cfg);}else{window.__warmupError='spine.SpinePlayer is not a function';}}catch(e){window.__warmupError=e.message||e;}})();</script></body></html>`;
    await page.setContent(warmupHtml, { waitUntil: 'networkidle', timeout: 60000 });
    let names = [];
    for (let i = 0; i < 40; i++) {
      await new Promise(r => setTimeout(r, 500));
      if (page.isClosed()) break;
      try {
        const w = await page.evaluate(() => window);
        if (w.__warmup && w.__warmup.skeletonData && w.__warmup.skeletonData.animations) {
          names = w.__warmup.skeletonData.animations.map(a => a.name).filter(Boolean);
          break;
        }
        if (w.__warmupError) {
          if (w.spine && w.spine.SkeletonData) {
            try {
              const sd = await page.evaluate(() => {
                if (window.spine && window.spine.SkeletonData) {
                  const s = new window.spine.SkeletonData();
                  return { hasAnimations: !!s.animations, animNames: s.animations ? Object.keys(s.animations) : [] };
                }
                return null;
              });
              if (sd && sd.animNames.length > 0) { names = sd.animNames; break; }
            } catch {}
          }
          break;
        }
      } catch {}
    }
    return names;
  } finally {
    try { await page.close(); } catch {}
  }
}

const atlasLocalPath = path.join(firstSet.path, atlasFile);
let atlasContent = fs.readFileSync(atlasLocalPath, 'utf8');
atlasContent = atlasContent.replace(/^\.\.[\/\\]textures[\/\\]/gm, '');
const reconciledAtlas = reconcileDdsAtlasPages(atlasContent,textureFiles);
atlasContent = reconciledAtlas.text;


const isDefault = args.animation && args.defaultAnimation && args.animation === args.defaultAnimation;

console.error(`Entry: ${args.uploadId}`);
console.error(`Set: ${firstSet.name}`);
console.error(`Skeleton: ${skeletonFile} (v${skeletonVersion})`);
console.error(`Skeleton bounds: ${rawSkelWidth}x${rawSkelHeight}`);
console.error(`Video dimensions: ${videoWidth}x${videoHeight} (from bounds + ${PAD_RATIO * 100}% padding)`);
console.error(`Atlas: ${atlasFile}`);
// Works that ship begin/end (or in/out) plus idle are recorded as a loop of the
// whole scenario, so the preview video shows the same cycle the player runs.
const animationToken = (name) => String(name || '').trim().toLowerCase().split('/').pop();
const tokenIndex = new Map();
for (const name of availableAnimations) {
  const token = animationToken(name);
  if (token && !tokenIndex.has(token)) tokenIndex.set(token, name);
}
const scenarioEntry = tokenIndex.has('in') ? tokenIndex.get('in') : tokenIndex.get('begin');
const scenarioExit = tokenIndex.has('out') ? tokenIndex.get('out') : tokenIndex.get('end');
const scenarioIdle = tokenIndex.has('idle') ? tokenIndex.get('idle') : tokenIndex.get('loop');
const scenarioCycle = !args.animation && scenarioEntry && scenarioExit ? [scenarioEntry, scenarioIdle, scenarioIdle, scenarioExit].filter(Boolean) : [];
const captureAnimation = scenarioCycle.length > 1 ? scenarioCycle[0] : targetAnimation;
if (scenarioCycle.length > 1) {
  console.error(`Scenario: ${scenarioCycle.join(' -> ')} (запись превью по кругу)`);
}
console.error(`Animation: ${captureAnimation}`);
console.error(`Is default: ${isDefault}`);

// Capture page builder. activeSkin selects the Spine skin to render; when
// null the player default is used. Some skeletons draw nothing with the
// default skin, so the export retries with named skins (see skinCandidates).
function buildCaptureHtml(activeSkin) {
const skinLine = activeSkin ? `    skin: ${JSON.stringify(activeSkin)},\n` : '';
return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${playerCssUrl}">
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: 100%; height: 100%; background: ${args.alpha ? 'transparent' : '#050607'}; overflow: hidden; }
#player { width: 100%; height: 100%; }
</style>
</head>
<body>
<div id="player"></div>
<script src="${playerJsUrl}"></script>
<script>
(function() {
  window.__captureError = null;
  window.__animDuration = 0;
  window.__ready = false;

  var player;
  // Peak brightness of the currently rendered frame (center sample).
  // Used by the exporter to detect "rendered nothing but background" and
  // fall back to another skin. Requires preserveDrawingBuffer (set below).
  window.__framePeak = function () {
    try {
      var c = player && player.canvas;
      if (!c) return -1;
      var g = c.getContext('webgl2') || c.getContext('webgl');
      if (!g) return -1;
      var w = g.drawingBufferWidth, h = g.drawingBufferHeight;
      if (!w || !h) return -1;
      // Check nine locations, not just the center of the game camera.
      // No pixels are persisted or sent to CI.
      var sw = Math.min(w, 112), sh = Math.min(h, 112);
      var buf = new Uint8Array(sw * sh * 4), mx = 0;
      for (var gy = 0; gy < 3; gy++) for (var gx = 0; gx < 3; gx++) {
        var x = Math.max(0, Math.round((w - sw) * gx / 2));
        var y = Math.max(0, Math.round((h - sh) * gy / 2));
        g.readPixels(x, y, sw, sh, g.RGBA, g.UNSIGNED_BYTE, buf);
        for (var i = 0; i < buf.length; i += 4) {
          var m = Math.max(buf[i], buf[i+1], buf[i+2]);
          if (m > mx) mx = m;
        }
      }
      return mx;
    } catch (e) { return -1; }
  };
  var config = {
    ${skeletonPlayerKey}: '${skeletonRawUrl}',
    ${atlasPlayerKey}: '${atlasRawUrl}',
    textures: ${JSON.stringify(textureRawUrls)},
    animation: ${JSON.stringify(captureAnimation)},
    scenario: ${JSON.stringify(scenarioCycle)},
    __spineScenario: ${JSON.stringify(scenarioCycle)},
${skinLine}    showLoading: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: true,
    alpha: true,
    backgroundColor: '${args.alpha ? '#00000000' : '#050607'}',
    viewport: ${hugeScene ? JSON.stringify({ x: -videoWidth / 2, y: -videoHeight / 2, width: videoWidth, height: videoHeight, padLeft: '0%', padRight: '0%', padTop: '0%', padBottom: '0%' }) : "{ padLeft: '0%', padRight: '0%', padTop: '0%', padBottom: '0%' }"},
    success: function (p) {
      player = p;
      window.__exportPlayer = p;
      var runtimeData = player.skeleton && player.skeleton.data || player.skeletonData;
      window.__animationNames = runtimeData && runtimeData.animations ? runtimeData.animations.map(function(a) { return a.name; }) : [];
      window.__runtimeSkinNames = runtimeData && Array.isArray(runtimeData.skins) ?
        runtimeData.skins.map(function(s){return s && s.name;}).filter(Boolean) : [];
      window.__selectedAnimation = ${JSON.stringify(captureAnimation)} || window.__animationNames[0] || '';
      if (window.__selectedAnimation && player.animationState) {
        player.animationState.clearTracks();
        player.animationState.setAnimation(0, window.__selectedAnimation, true);
      }
      window.__ready = true;
      window.__canvasWidth = player.canvas ? player.canvas.width : 0;
      window.__canvasHeight = player.canvas ? player.canvas.height : 0;
      
      // begin -> idle -> idle -> end, on repeat, so the recorded preview shows the
      // same loop the player plays on the work page.
      try {
        var cycle = Array.isArray(window.__spineScenario) ? window.__spineScenario : [];
        if (cycle.length > 1 && player.animationState) {
          var mixed = 0;
          cycle.forEach(function (name, i) {
            if (i === 0) player.setAnimation(0, name, true);
            else player.animationState.addAnimation(0, name, true, mixed);
          });
          var state = player.animationState;
          var originalSetAnimation = state.setAnimation.bind(state);
          state.setAnimation = function (trackIndex, name, loop) {
            var entry = originalSetAnimation(trackIndex, name, loop);
            // Keep the cycle running: when it ends, restart from the first step.
            var current = state.getCurrent(0);
            if (current && !current.next) {
              current.next = { animation: cycle[0], delay: 0, loop: true, mixDuration: mixed, mixTime: mixed };
            }
            return entry;
          };
        }
      } catch (e) {}

      // Older runtime TrackEntry implementations may report duration=0
      // even when the decoded animation has real keyframe timelines.
      try {
        var track = player.animationState ? player.animationState.getCurrent(0) : null;
        var trackDuration = Number(track && track.animation && track.animation.duration) || 0;
        var sourceAnimation = runtimeData && Array.isArray(runtimeData.animations)
          ? runtimeData.animations.find(function(a){ return a && a.name === window.__selectedAnimation; })
          : null;
        var skeletonDuration = Number(sourceAnimation && sourceAnimation.duration) || 0;
        var foundAnimation = runtimeData && typeof runtimeData.findAnimation === 'function'
          ? runtimeData.findAnimation(window.__selectedAnimation) : null;
        var foundDuration = Number(foundAnimation && foundAnimation.duration) || 0;
        window.__animDuration = Math.max(trackDuration, skeletonDuration, foundDuration);
      } catch (e) {}

      // Recording is started explicitly via window.__startRecording() AFTER
      // the canvas has reached its final size. Starting captureStream on the
      // initial 300x150 default canvas breaks the track when the player
      // resizes it: every recorded frame comes out black even though the
      // live canvas renders fine.
      window.__canvasSize = function () {
        if (player && player.canvas) return [player.canvas.width, player.canvas.height];
        return [0, 0];
      };
      window.__startRecording = function () {
        try {
          if (!player || !player.canvas) return 'no-canvas';
          var stream = player.canvas.captureStream(${args.fps});
          var recorder = new MediaRecorder(stream, { mimeType: 'video/webm;codecs=vp9' });
          var chunks = [];
          recorder.ondataavailable = function(e) { if (e.data.size > 0) chunks.push(e.data); };
          recorder.onstop = function() {
            var blob = new Blob(chunks, { type: 'video/webm' });
            var reader = new FileReader();
            reader.onload = function() { window.__videoData = reader.result; };
            reader.readAsDataURL(blob);
          };
          recorder.start();

          window.__stopRecording = function() {
            if (recorder.state === 'recording') recorder.stop();
          };
          return 'recording';
        } catch (err) {
          return 'error: ' + err.message;
        }
      };
    },
    error: function (p, err) {
      window.__captureError = 'Player creation failed: ' + err;
    }
  };

  if (spine.AtlasAttachmentLoader && !window.__spinePatched) {
    window.__spinePatched = true;
    var p = spine.AtlasAttachmentLoader.prototype;
    var _findRegion = p.findRegion;
    if (typeof _findRegion === 'function') {
      p.findRegion = function() { try { return _findRegion.apply(this, arguments); } catch(e) { return null; } };
    }
    var _findRegions = p.findRegions;
    if (typeof _findRegions === 'function') {
      p.findRegions = function() { try { return _findRegions.apply(this, arguments); } catch(e) { return []; } };
    }
    ['newRegionAttachment','newMeshAttachment','newBoundingBoxAttachment','newPathAttachment','newPointAttachment','newClippingAttachment'].forEach(function(m) {
      var orig = p[m];
      if (typeof orig !== 'function') return;
      p[m] = function() { try { return orig.apply(this, arguments); } catch(e) { return null; } };
    });

    ['RegionAttachment','MeshAttachment'].forEach(function(name) {
      var ctor = spine[name];
      if (typeof ctor !== 'function') return;
      var cuv = ctor.prototype.computeUVs;
      if (typeof cuv !== 'function') return;
      ctor.prototype.computeUVs = function() {
        try { return cuv.apply(this, arguments); } catch(e) {}
      };
    });
  }

  try {
    if (typeof spine.SpinePlayer === 'function') {
      new spine.SpinePlayer('player', config);
    } else {
      window.__captureError = 'spine.SpinePlayer is not a function';
    }
  } catch (e) {
    window.__captureError = 'Player creation failed: ' + (e.message || e);
  }
})();
</script>
</body>
</html>`;
}

const tempDir = path.join('/tmp', `spine-export-${Date.now()}`);
fs.mkdirSync(tempDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
  ...(process.env.PLAYWRIGHT_EXECUTABLE ? { executablePath: process.env.PLAYWRIGHT_EXECUTABLE } : {}),
  args: [
    '--no-sandbox',
    '--disable-setuid-sandbox',
    '--use-gl=swiftshader',
    '--enable-webgl',
    '--ignore-gpu-blocklist',
    '--disable-gpu-sandbox',
  ],
});

try {
  const context = await browser.newContext({
    viewport: { width: videoWidth, height: videoHeight },
    reducedMotion: 'no-preference',
  });
  const page = await context.newPage();

  // Serve runtime scripts and styles from the checkout. A transient CDN outage
  // must never stop a deterministic render of already committed Spine assets.
  // Fetch the exact 4.0/4.1/4.2 runtime into an isolated CI directory.
  // A CDN URL is kept as the virtual page URL, but it is fulfilled locally,
  // avoiding timeout/redirect/CORS failures on the runner.
  const versionedRuntimeRoot = process.env.SPINE_VERSIONED_PLAYER_DIR || '';
  const versionedAssets = versionedRuntimeRoot && modernRuntime !== '4.3' && !isLegacy ? [
    [playerJsUrl, path.join(versionedRuntimeRoot,'node_modules/@esotericsoftware/spine-player/dist/iife/spine-player.js'), 'application/javascript'],
    [playerCssUrl, path.join(versionedRuntimeRoot,'node_modules/@esotericsoftware/spine-player/dist/spine-player.css'), 'text/css'],
  ] : [];
  for (const [url, filename, type] of [...(isLegacy || modernRuntime === '4.3' ? [
    [playerJsUrl, isLegacy
      ? path.join(repoRoot, 'public', `vendor-spine-player-${versionMajor}.${runtimeMinor}.js`)
      : path.join(repoRoot, 'node_modules/@esotericsoftware/spine-player/dist/iife/spine-player.js'), 'application/javascript'],
    [playerCssUrl, isLegacy
      ? path.join(repoRoot, 'public', `vendor-spine-player-${versionMajor}.${runtimeMinor}.css`)
      : path.join(repoRoot, 'node_modules/@esotericsoftware/spine-player/dist/spine-player.css'), 'text/css'],
  ] : []), ...versionedAssets]) {
    if (!fs.existsSync(filename)) {
      console.error('LOCAL_SPINE_RUNTIME_MISSING ' + path.basename(filename));
      continue;
    }
    await page.route(url, route => route.fulfill({
      status: 200, contentType: type, body: fs.readFileSync(filename),
    }));
    console.error('LOCAL_SPINE_RUNTIME_READY ' + path.basename(filename));
    if(versionedAssets.some(asset=>asset[0]===url)) console.error('VERSIONED_LOCAL_PLAYER_READY '+modernRuntime);
  }

  page.on('console', msg => console.error(`[BROWSER ${msg.type()}] ${msg.text()}`));
  page.on('pageerror', err => console.error(`[BROWSER ERROR] ${err.message}`));

  await page.route(atlasRawUrl, async route => {
    await route.fulfill({
      status: 200,
      contentType: 'application/octet-stream',
      body: atlasContent,
    });
  });
  await page.route(skeletonRawUrl, async route => {
    let body;
    if (skeletonFile.toLowerCase().endsWith('.skel')) {
      const rawBuffer = fs.readFileSync(skeletonFilePath);
      body = args.sanitizeSkel ? sanitizedSkelBuffer(rawBuffer, skeletonVersion) : rawBuffer;
    } else {
      body = fs.readFileSync(skeletonFilePath, 'utf8');
    }
    await route.fulfill({
      status: 200,
      contentType: skeletonFile.toLowerCase().endsWith('.skel') ? 'application/octet-stream' : 'application/json',
      body: body,
    });
  });
  for (const texFile of textureFiles) {
    const texUrl = rawUrl(texFile);
    const texPath = path.join(firstSet.path, texFile);
    const texExt = path.extname(texFile).toLowerCase();
    const texContentType = texExt === '.png' ? 'image/png' : texExt === '.webp' ? 'image/webp' : texExt === '.jpg' || texExt === '.jpeg' ? 'image/jpeg' : 'application/octet-stream';
    await page.route(texUrl, async route => {
      await route.fulfill({
        status: 200,
        contentType: texContentType,
        body: fs.readFileSync(texPath),
      });
    });
  }
  // Skin fallback: the player default skin sometimes renders nothing but the
  // background (e.g. a skeleton whose visible attachments live on a named
  // skin). Capture with the default first to preserve existing renders,
  // then retry with each named non-default skin until a frame shows content.
  const FRAME_PEAK_MIN = 40;
  const skinNames = readSkinNames(skeletonFilePath);
  const skinCandidates = [null, ...skinNames.filter((s) => s && s.toLowerCase() !== 'default')];
  console.error(`Skin candidates: ${JSON.stringify(skinCandidates)}`);

  let chosenSkin = null;
  let animDuration = 0;
  let effectiveDuration = 0;
  let captureDuration = 0;
  let canvasWidth = videoWidth;
  let canvasHeight = videoHeight;
  let videoDataUrl = null;
  let lastCaptureError = null;

  for (const skin of skinCandidates) {
    const label = skin === null ? '(default)' : `'${skin}'`;
    await page.setContent(buildCaptureHtml(skin), { waitUntil: 'load', timeout: 60000 });
    let ready = true;
    try {
      await page.waitForFunction(() => window.__ready === true || window.__captureError, { timeout: 60000, polling: 200 });
    } catch {
      ready = false;
    }
    const error = ready ? await page.evaluate(() => window.__captureError || null) : 'Timed out waiting for player ready';
    if (error) {
      lastCaptureError = error;
      console.error(`Capture with skin ${label} failed: ${error}`);
      break; // player/skeleton broken — another skin will not fix it
    }

    const runtimeAnimations = await page.evaluate(() => window.__animationNames || []);
    if (!availableAnimations.length) availableAnimations.push(...runtimeAnimations);
    // Binary .skel has no JSON sibling to list skins from. The active 3.8/4.x
    // runtime exposes them after load: retry named skins instead of recording
    // a black default skin as a successful clip.
    const runtimeSkins = await page.evaluate(() => window.__runtimeSkinNames || []);
    for (const skinName of runtimeSkins.slice(0,24)) {
      if (typeof skinName === 'string' && skinName &&
          skinName.toLowerCase() !== 'default' && !skinCandidates.includes(skinName))
        skinCandidates.push(skinName);
    }
    if (!targetAnimation) targetAnimation = await page.evaluate(() => window.__selectedAnimation || '');
    animDuration = await page.evaluate(() => window.__animDuration || 0);
    canvasWidth = await page.evaluate(() => window.__canvasWidth || 0) || videoWidth;
    canvasHeight = await page.evaluate(() => window.__canvasHeight || 0) || videoHeight;

    // Fallback: if the player reported duration=0 (e.g. Spine 4.2.x JSON with
    // no top-level 'duration' field), compute it from raw JSON timeline data.
    effectiveDuration = animDuration;
    if (effectiveDuration <= 0 && targetAnimation) {
      const fallbackDuration = readJsonAnimationDuration(skeletonFilePath, targetAnimation);
      if (fallbackDuration > 0) {
        console.error(`Player reported duration=0, using JSON timeline max time=${fallbackDuration}s for '${targetAnimation}'`);
        effectiveDuration = fallbackDuration;
      }
    }

    // Let a few frames render, then wait for the canvas backing store to
    // settle at its final size. Starting the recorder earlier (on the
    // initial 300x150 canvas) breaks the capture track on resize.
    await new Promise((resolve) => setTimeout(resolve, 1000));
    let canvasSize = [0, 0];
    let stableCount = 0;
    for (let i = 0; i < 20; i++) {
      const s = await page.evaluate(() => (typeof window.__canvasSize === 'function' ? window.__canvasSize() : [0, 0]));
      if (s[0] > 0 && s[0] === canvasSize[0] && s[1] === canvasSize[1]) {
        stableCount++;
        if (stableCount >= 2) break;
      } else {
        stableCount = 0;
      }
      canvasSize = s;
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
    canvasWidth = canvasSize[0] || videoWidth;
    canvasHeight = canvasSize[1] || videoHeight;
    const framePeak = await page.evaluate(() => (typeof window.__framePeak === 'function' ? window.__framePeak() : -1));
    console.error(`Skin ${label}: frame peak=${framePeak}, canvas=${canvasWidth}x${canvasHeight}, duration=${animDuration}s`);
    const moreSkins = skinCandidates.indexOf(skin) < skinCandidates.length - 1;
    if (framePeak < FRAME_PEAK_MIN && moreSkins) {
      console.error(`Skin ${label} rendered no visible content, trying next skin...`);
      continue;
    }
    if (framePeak < FRAME_PEAK_MIN && !moreSkins) {
      lastCaptureError = 'No visible pixels from any available Spine skin';
      console.error('NO_VISIBLE_SPINE_FRAME');
      break;
    }

    // Preserve the full animation duration.
    captureDuration = effectiveDuration;
    // A scenario is recorded in full: every step plays once, back to back.
    if (scenarioCycle.length > 1) {
      let scenarioDuration = 0;
      for (const stepName of scenarioCycle) {
        const stepDuration = readJsonAnimationDuration(skeletonFilePath, stepName);
        scenarioDuration += stepDuration > 0 ? stepDuration : effectiveDuration;
      }
      if (scenarioDuration > 0) {
        captureDuration = scenarioDuration;
        console.error(`Scenario duration: ${scenarioDuration.toFixed(2)}s (${scenarioCycle.join(' + ')})`);
      }
    }
    // A 1/30-second fallback produces a technically decodable but invisible
    // 8-frame clip. When an old binary omits a duration, sample a real 2s
    // loop of the actual Spine runtime instead. Source duration stays marked
    // unknown; the resulting preview duration is measured from the recording.
    if (!(captureDuration >= 0.5) && availableAnimations.includes(targetAnimation)) {
      captureDuration = 2;
      console.error('ANIMATION_SOURCE_DURATION_UNKNOWN: capturing 2s live preview loop');
    }
    if (!(captureDuration >= 0.5)) throw new Error('Cannot establish playable animation duration');
    if (args.alpha) {
      const framesDir = path.join(tempDir, 'alpha-frames');
      fs.mkdirSync(framesDir, { recursive: true });
      await page.clock.install({ time: new Date('2020-01-01T00:00:00Z') });
      await page.clock.pauseAt(new Date('2020-01-01T00:01:00Z'));
      await page.evaluate(name => {
        const p = window.__exportPlayer;
        p.animationState.clearTracks();
        p.animationState.setAnimation(0, name, true);
        p.paused = false;
      }, targetAnimation);
      const count = Math.max(1, Math.ceil(captureDuration * args.fps));
      for (let index = 0; index < count; index++) {
        await page.clock.runFor(1000 / args.fps);
        const png = await page.evaluate(() => window.__exportPlayer.canvas.toDataURL('image/png').split(',')[1]);
        fs.writeFileSync(path.join(framesDir, `${String(index).padStart(6, '0')}.png`), Buffer.from(png, 'base64'));
      }
      videoDataUrl = 'alpha-frames';
      chosenSkin = skin;
      break;
    }
    // Start recording only now, on the settled canvas showing content.
    const recState = await page.evaluate(() => (typeof window.__startRecording === 'function' ? window.__startRecording() : 'missing'));
    console.error(`Skin ${label}: recorder ${recState}`);
    if (recState !== 'recording') {
      lastCaptureError = `MediaRecorder failed to start (${recState})`;
      console.error(`Capture with skin ${label} failed: ${lastCaptureError}`);
      break;
    }

    await new Promise((resolve) => setTimeout(resolve, captureDuration * 1000));

    await page.evaluate(() => {
      if (window.__stopRecording) window.__stopRecording();
    });

    try {
      videoDataUrl = await page.waitForFunction(() => window.__videoData, { timeout: 15000 }).then((h) => h.jsonValue());
    } catch {
      videoDataUrl = null;
    }
    if (!videoDataUrl) {
      // Headless MediaRecorder can return no Blob even though the real Spine
      // canvas is visibly animating. Keep the live page for CDP frame recovery.
      chosenSkin = skin;
      lastCaptureError = 'No video data captured by MediaRecorder';
      console.error(`Capture with skin ${label} failed: ${lastCaptureError}`);
      break;
    }
    chosenSkin = skin;
    console.error(`Capture skin: ${label} (peak ${framePeak})`);
    break;
  }

  if (!videoDataUrl) {
    const peak = await page.evaluate(() =>
      typeof window.__framePeak === 'function' ? window.__framePeak() : -1).catch(() => -1);
    if (!args.alpha && peak >= FRAME_PEAK_MIN &&
        lastCaptureError === 'No video data captured by MediaRecorder') {
      // Preserve the selected real Spine runtime canvas and draw frames with
      // the CDP renderer, instead of exiting before the existing fallback.
      console.error('MEDIARECORDER_NO_BLOB: recovering visible live canvas');
      videoDataUrl = 'canvas-fallback';
    } else {
      throw new Error(`Capture failed: ${lastCaptureError || 'no skin produced visible content'}`);
    }
  }

  const videoPath = path.join(tempDir, 'browser-recording.webm');
  if (args.alpha) {
    execFileSync('ffmpeg', ['-y', '-v', 'error', '-framerate', String(args.fps), '-i', path.join(tempDir, 'alpha-frames', '%06d.png'), '-c:v', 'libvpx-vp9', '-pix_fmt', 'yuva420p', '-auto-alt-ref', '0', '-deadline', 'realtime', '-cpu-used', '8', videoPath], { stdio: 'inherit' });
  } else if (videoDataUrl !== 'canvas-fallback') {
    fs.writeFileSync(videoPath, Buffer.from(videoDataUrl.split(',')[1], 'base64'));
  }
  // Headless Chromium may display a nonempty WebGL canvas while
  // MediaRecorder captures uniform dark frames on legacy Spine 3.8 runtimes.
  // Sample the ENCODED result, not just a live player pixel, and if it is
  // effectively blank, capture deterministic PNG frames from the real Spine
  // runtime and encode those as the WebM source. These temporary frames never
  // leave the private runner and are not included in any artifact.
  if (!args.alpha) {
    const seemsVisible = (data) => {
      if (!data || data.length < 200) return false;
      const background = data[0];
      let differing = 0, lit = 0;
      for (let i = 0; i < data.length; i++) {
        if (Math.abs(data[i] - background) >= 10) differing++;
        if (data[i] > 24) lit++;
      }
      return differing >= 12 || lit >= 24;
    };
    const encodedHasContent = (filename, duration) => {
      const seconds = [0,0.18,0.55,1,2];
      if (duration > 0) for (const part of [0.12,0.32,0.57,0.81,0.94])
        seconds.push(Math.max(0, duration * part));
      for (const ss of seconds.filter(x => x < duration || duration <= 0)) {
        try {
          const gray = execFileSync('ffmpeg', [
            '-v','error','-ss',String(ss),'-i',filename,'-frames:v','1',
            '-vf','scale=48:48,format=gray','-f','rawvideo','-',
          ], {stdio:['ignore','pipe','ignore'],maxBuffer:100000});
          if (seemsVisible(gray)) return true;
        } catch {}
      }
      return false;
    };
    let mediaFrames=0;
    try{
      mediaFrames=Number(execFileSync('ffprobe',['-v','error','-count_frames',
        '-select_streams','v:0','-show_entries','stream=nb_read_frames',
        '-of','default=nw=1:nk=1',videoPath],{encoding:'utf8',timeout:30000}).trim())||0;
    }catch{mediaFrames=0;}
    const mediaBytes=fs.existsSync(videoPath) ? fs.statSync(videoPath).size : 0;
    const shortCapture=!fs.existsSync(videoPath) ||
      shouldUseCanvasFallback({bytes:mediaBytes,frames:mediaFrames,
      duration:captureDuration,fps:args.fps});
    if (shortCapture || !encodedHasContent(videoPath, captureDuration)) {
      console.error('RECORDED_WEBM_INCOMPLETE: fallback to deterministic on-screen Spine rendering');
      const framesDir = path.join(tempDir,'deterministic-frames');
      fs.mkdirSync(framesDir,{recursive:true});
      const duration = Math.max(1/args.fps, captureDuration || effectiveDuration || 1);
      const frameCount = fallbackFrameCount({fps:args.fps,duration});
      const intervalMs = duration * 1000 / frameCount;
      // The browser still renders a visible WebGL scene, but Playwright's
      // fake-clock pause can prevent Spine's rAF/WebGL compositor from drawing.
      // Capture REAL on-screen canvas frames using wall-clock rAF and Chromium's
      // compositor. All PNGs stay in this private runner's temporary folder.
      await page.evaluate(name=>{
        const player=window.__exportPlayer;
        if(!player || !player.canvas || !player.animationState)
          throw new Error('No active Spine runtime for real-time fallback');
        player.animationState.clearTracks();
        player.animationState.setAnimation(0,name,true);
        player.paused=false;
      },targetAnimation);
      const canvasHost=page.locator('#player canvas').first();
      await canvasHost.waitFor({state:'visible',timeout:10000});
      let visibleFrames=0;
      const frameHashes=new Set();
      for(let frame=0;frame<frameCount;frame++){
        await new Promise(r=>setTimeout(r,Math.max(10,intervalMs)));
        const peak=await page.evaluate(()=>typeof window.__framePeak==='function' ? window.__framePeak() : -1);
        if(peak>=40)visibleFrames++;
        // CDP screenshot captures the actual composited canvas, including
        // graphics that do not survive canvas.toDataURL in headless WebGL.
        const png=await canvasHost.screenshot({type:'png',timeout:15000});
        if(!png||png.length<100)throw new Error('Real-time canvas screenshot failed');
        frameHashes.add(createHash('sha256').update(png).digest('hex'));
        fs.writeFileSync(path.join(framesDir,String(frame).padStart(6,'0')+'.png'),png);
      }
      if(visibleFrames<2)throw new Error('No visible real-time Spine frames');
      if(frameHashes.size<2)throw new Error('Selected animation has no changing canvas frames');
      console.error('REALTIME_CANVAS_CAPTURE_PASS VISIBLE_FRAMES='+visibleFrames+' DISTINCT='+frameHashes.size);
      const recovered=path.join(tempDir,'deterministic.webm');
      execFileSync('ffmpeg',[
        '-y','-v','error','-framerate',String(frameCount/duration),
        '-i',path.join(framesDir,'%06d.png'),
        '-c:v','libvpx-vp9','-pix_fmt','yuv420p','-deadline','realtime',
        '-cpu-used','8','-threads','3','-auto-alt-ref','0',recovered,
      ],{stdio:'inherit'});
      if (!encodedHasContent(recovered,duration))
        throw new Error('Spine runtime generated blank deterministic frames; artwork requires native inspection');
      const actualFrames=Number(execFileSync('ffprobe',['-v','error','-count_frames',
        '-select_streams','v:0','-show_entries','stream=nb_read_frames',
        '-of','default=nw=1:nk=1',recovered],{encoding:'utf8',timeout:30000}).trim())||0;
      if(actualFrames<frameCount-2)throw new Error('Recovered canvas animation is missing encoded frames');
      fs.copyFileSync(recovered,videoPath);
      fs.rmSync(framesDir,{recursive:true,force:true});
      console.error('DETERMINISTIC_FRAME_FALLBACK_PASS FRAMES='+actualFrames);
    }
  }
  const webmBuffer = fs.readFileSync(videoPath);

  await context.close();

  const videoSize = webmBuffer.length;
  console.error(`MediaRecorder recording: ${videoPath} (${videoSize} bytes)`);

  if (videoSize < 100) {
    console.error('Recorded video is too small, possibly empty');
    process.exit(1);
  }

  const outputPath = args.output || `${args.uploadId}-${targetAnimation}-preview.webm`;
  fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
  fs.copyFileSync(videoPath, outputPath);

  console.error(`WebM saved: ${outputPath} (${webmBuffer.length} bytes, ${canvasWidth}x${canvasHeight})`);

  // MediaRecorder can start before the first real frame lands on the canvas,
  // and the amount of leading black it captures varies per run (7 frames for
  // one variant, 21 for another), so waiting a fixed time is not reliable.
  // Measure the file that was actually recorded and drop a leading *flat* black
  // run. Deliberate fade-ins ramp out of black and are kept.
  //
  // This runs before the quality ladder and the posters are generated, so all
  // three WebM variants and all three WebP posters inherit the trimmed start.
  const leadResult = args.alpha ? {} : trimBlackLead(outputPath, {
    label: path.basename(outputPath),
    log: (line) => console.error(line),
  });
  if (leadResult.trimmed) {
    console.error(`Black lead trimmed: ${leadResult.cut} frame(s) removed before export`);
  }

  const qualitySource = path.join(tempDir, 'quality-source.webm');
  fs.copyFileSync(outputPath, qualitySource);

  // Use ffmpeg to generate 3 qualities of WebM and 3 WebP posters
  const baseOutputPath = outputPath.replace(/\.webm$/i, '');
  const outPaths = {
    webmHigh: outputPath,
    webmMedium: `${baseOutputPath}-medium.webm`,
    webmLow: `${baseOutputPath}-low.webm`,
    webpHigh: `${baseOutputPath}.webp`,
    webpMedium: `${baseOutputPath}-medium.webp`,
    webpLow: `${baseOutputPath}-low.webp`,
  };
  // Accessible to the output-metadata builder after the try/catch block.
  let mediumFallback = false;
  let lowFallback = false;

  // Битрейт считаем от числа пикселей кадра. Раньше стояло фиксированное
  // 1200k, а на кадре 1644x1612 это меньше половины бита на пиксель —
  // картинка рассыпается, и это выглядит как низкий фреймрейт.
  const pixels = videoWidth * videoHeight;
  const bitrateFor = (bitsPerPixel) => {
    const kbps = Math.round((pixels * bitsPerPixel) / 1000);
    return `${Math.max(450, Math.min(6000, kbps))}k`;
  };
  const bitrates = { high: bitrateFor(120), medium: bitrateFor(60), low: bitrateFor(28) };
  
  // Calculate scaled dimensions (keeping aspect ratio, ensuring even numbers).
  //
  // The three tiers used to be absolute width caps: 1080 / 720 / 360. Because
  // calcScale returned the source size untouched whenever the source was
  // already at or below the cap, any clip rendered at 960 wide produced a
  // "720p" file that was byte-for-byte the 1080p one — the picker handed out
  // two names for the same video. Tiers are now proportional steps of the
  // source, so each one is genuinely smaller than the tier above it.
  function scaleTo(targetWidth) {
    if (videoWidth <= targetWidth) return `${videoWidth & ~1}x${videoHeight & ~1}`;
    const scale = targetWidth / videoWidth;
    const width = Math.round(videoWidth * scale) & ~1;
    const height = Math.round(videoHeight * scale) & ~1;
    return `${Math.max(2, width)}x${Math.max(2, height)}`;
  }

  // high = source, medium = 2/3 of source, low = 1/3 of source. Each step is
  // applied only when it actually shrinks the frame, so small clips keep a
  // readable size at the high tier instead of collapsing to a few pixels.
  const dimHigh = `${videoWidth & ~1}x${videoHeight & ~1}`;
  const dimMedium = scaleTo(Math.round(videoWidth * 0.66));
  const dimLow = scaleTo(Math.round(videoWidth * 0.33));
  console.error(`Quality ladder: high=${dimHigh} medium=${dimMedium} low=${dimLow}`);

  try {
    const { execSync } = await import('child_process');
    console.error(`Running ffmpeg to generate multiple qualities...`);
    
    // WebM Generation
    // High Quality
    // deadline=realtime заставляет кодировщик выдать все кадры: при
    // deadline=good он часть просто отбрасывает, и анимация идёт рывками.
    // lag-in-frames 0 убирает задержку между кадрами на выходе.
    const vp9 = (dim, bitrate, out) =>
      `ffmpeg -y -v error ${args.alpha ? "-c:v libvpx-vp9" : ""} -i "${qualitySource}" -s ${dim} -c:v libvpx-vp9 -b:v ${bitrate} ` +
      `-pix_fmt ${args.alpha ? "yuva420p" : "yuv420p"} -deadline realtime -cpu-used 8 -lag-in-frames 0 ` +
      `-auto-alt-ref 0 -row-mt 1 -g ${args.fps} -threads 4 "${out}"`;

    // MediaRecorder already produces a VP9 full-resolution source. It was
    // wastefully transcoded AGAIN with 16 threads even for 1920px/long clips;
    // that exhausted ffmpeg resources for the four large legacy projects.
    // Preserve the original validated high-quality VP9 bytes, and encode only
    // genuinely smaller medium/low variants with bounded thread counts.
    if (args.alpha) {
      execSync(vp9(dimHigh, bitrates.high, outPaths.webmHigh), { stdio: 'inherit' });
    } else {
      fs.copyFileSync(qualitySource, outPaths.webmHigh);
      console.error('High quality uses original VP9 recording; no redundant encoding');
    }
    // Do not lose a verified playable high WebM merely because a legacy
    // 3.x animation is too resource-heavy for a resized VP9 transcode.
    // Keep a truthful source-quality fallback for that tier, and record its
    // actual width in metadata rather than falsely advertising 720p/360p.
    const encodeTier = (dim, bitrate, output, tier) => {
      try {
        execSync(vp9(dim, bitrate, output), { stdio: 'inherit' });
        return false;
      } catch (_) {
        fs.copyFileSync(qualitySource, output);
        console.error('Encoder fallback for ' + tier + ': using validated original VP9 recording');
        return true;
      }
    };
    mediumFallback = encodeTier(dimMedium, bitrates.medium, outPaths.webmMedium, 'medium');
    lowFallback = encodeTier(dimLow, bitrates.low, outPaths.webmLow, 'low');
    if (mediumFallback || lowFallback) console.error('QUALITY_TIER_FALLBACK_SOURCE');

    // WebP poster: a frame that actually has visible content.
    //
    // `-ss` before `-i` is an input seek -- ffmpeg jumps straight to a keyframe
    // and can emit a frame that is never displayed, which produced fully black
    // posters. Seeking after `-i` decodes properly, and if the opening frame is
    // still empty we walk forward through the clip until something is visible.
    function frameHasContent(pngPath) {
      try {
        const raw = execSync(
          `ffmpeg -y -v error -i "${pngPath}" -vf scale=48:48 -pix_fmt gray -f rawvideo -`,
          { stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 }
        );
        if (!raw || raw.length < 100) return false;
        let lit = 0, different = 0;
        const background = raw[0];
        for (let i = 0; i < raw.length; i++) {
          if (raw[i] > 24) lit++;
          if (Math.abs(raw[i] - background) >= 10) different++;
        }
        // Dark but detailed skins are real content, not a black poster.
        // A real small attachment can occupy fewer than 2% of the frame;
        // match the verified WebM content threshold, not an arbitrary area.
        return lit >= 24 || different >= 12;
      } catch (e) {
        return false;
      }
    }

    function pickPosterFrame(source, pngPath) {
      // An animation may have a long dark lead-in; scan real timeline
      // positions before marking an existing playable video as poster-less.
      let duration = 0;
      try { duration = Number(execFileSync('ffprobe', [
        '-v','error','-show_entries','format=duration','-of','default=noprint_wrappers=1:nokey=1', source
      ], {encoding:'utf8',stdio:['ignore','pipe','ignore']}).trim()) || 0; } catch {}
      const positions = new Set([0, 0.15, 0.35, 0.6, 0.9]);
      if(duration>0)for(const frac of [0.08,0.2,0.35,0.5,0.65,0.8,0.92])
        positions.add(Math.max(0,Math.min(duration-0.04,duration*frac)));
      for (const ss of [...positions].sort((a,b)=>a-b).filter(v=>v>=0 && (!duration || v<duration))) {
        try {
          execSync(`ffmpeg -y -v error -ss ${ss} -i "${source}" -vframes 1 -c:v png "${pngPath}"`, { stdio: 'inherit' });
        } catch (e) {
          continue;
        }
        if (frameHasContent(pngPath)) return ss;
        try { fs.rmSync(pngPath, { force: true }); } catch (e) {}
      }
      return null;
    }

    function convertToWebp(source, out, dim) {
      try {
        const pngPath = `${out}.frame.png`;
        const ss = pickPosterFrame(source, pngPath);
        if (ss === null) {
          throw new Error('no frame with visible content in the clip');
        }
        if (ss !== 0) {
          console.error(`  Poster: first frame was empty, using ${ss}s instead.`);
        }
        // Posters are optional for playback, so every encoder is tried in turn:
        // cwebp (webp package), ImageMagick convert, then ffmpeg, which is always
        // installed and carries libwebp. Without the last one a missing package
        // silently costs every poster on the site.
        let encoded = false;
        for (const attempt of [
          () => execSync(`cwebp -quiet "${pngPath}" -o "${out}"`, { stdio: 'inherit' }),
          () => execSync(`convert "${pngPath}" "${out}"`, { stdio: 'inherit' }),
          () => execSync(`ffmpeg -y -loglevel error -i "${pngPath}" -c:v libwebp -lossless 1 -quality 90 "${out}"`, { stdio: 'inherit' }),
        ]) {
          if (fs.existsSync(out) && fs.statSync(out).size > 0) { encoded = true; break; }
          try {
            attempt();
            if (fs.existsSync(out) && fs.statSync(out).size > 0) { encoded = true; break; }
          } catch (e) { /* try the next encoder */ }
        }
        if (!encoded) throw new Error('no WebP encoder available (cwebp, convert, ffmpeg)');
        fs.rmSync(pngPath, { force: true });
      } catch (err) {
        throw new Error(`WebP generation failed for ${out}: ${err.message}`);
      }
    }
    const webpDims = {
      high: dimHigh,
      medium: dimMedium,
      low: dimLow,
    };
    let webpOk = true;
    for (const q of ['high', 'medium', 'low']) {
      const webmSrc = outPaths[`webm${q[0].toUpperCase()}${q.slice(1)}`];
      const webpOut = outPaths[`webp${q[0].toUpperCase()}${q.slice(1)}`];
      try {
        convertToWebp(webmSrc, webpOut, webpDims[q]);
      } catch (err) {
        console.error(`WebP (${q}) failed: ${err.message}`);
        webpOk = false;
      }
    }
    if (webpOk) console.error(`WebP posters generated.`);
  } catch (err) {
    console.error(`FFmpeg processing failed or skipped: ${err.message}`);
    // Fallback if ffmpeg fails: copy the capture to the main output. This must be
    // outputPath (post-trim), not videoPath (pre-trim), or the black lead we just
    // removed would come straight back.
    throw err;
  }

  function getFileSize(filePath) {
    return fs.existsSync(filePath) ? fs.statSync(filePath).size : 0;
  }

  for (const output of [outPaths.webmHigh, outPaths.webmMedium, outPaths.webmLow]) {
    const probe = JSON.parse(execFileSync('ffprobe', ['-v', 'error', '-count_frames', '-select_streams', 'v:0', '-show_entries', 'stream=width,height,nb_read_frames', '-of', 'json', output], { encoding: 'utf8' }));
    if (!(probe.streams?.[0]?.width > 0) || !(Number(probe.streams[0].nb_read_frames) > 0)) throw new Error(`Invalid rendered video: ${output}`);
  }
  const finalWebmBuffer = fs.existsSync(outPaths.webmHigh) ? fs.readFileSync(outPaths.webmHigh) : Buffer.from([]);
  
  const widthOf = (dim) => Number(String(dim).split('x')[0]) || 0;
  const meta = {
    animation: targetAnimation,
    skin: chosenSkin === null ? 'default' : chosenSkin,
    animationDuration: captureDuration,
    sourceAnimationDuration: effectiveDuration || null,
    previewDurationInferred: !(effectiveDuration >= 0.5),
    // Real pixel width of each tier. The download picker labels its buttons
    // with these instead of a fixed "1080p/720p/360p", which only matched the
    // file for a handful of works and was wrong for the rest.
    animations: availableAnimations,
    skeleton: skeletonFile,
    atlas: atlasFile,
    textures: textureFiles,
    alpha: args.alpha,
    qualityWidths: { high: widthOf(dimHigh), medium: widthOf(mediumFallback ? dimHigh : dimMedium), low: widthOf(lowFallback ? dimHigh : dimLow) },
    capturedDuration: captureDuration,
    width: videoWidth,
    height: videoHeight,
    skeletonWidth: rawSkelWidth,
    skeletonHeight: rawSkelHeight,
    bytes: finalWebmBuffer.length,
    sha256: finalWebmBuffer.length > 0 ? createHash('sha256').update(finalWebmBuffer).digest('hex') : '',
    isDefault,
    files: {
      webmHigh: getFileSize(outPaths.webmHigh),
      webmMedium: getFileSize(outPaths.webmMedium),
      webmLow: getFileSize(outPaths.webmLow),
      webpHigh: getFileSize(outPaths.webpHigh),
      webpMedium: getFileSize(outPaths.webpMedium),
      webpLow: getFileSize(outPaths.webpLow)
    }
  };
  fs.writeFileSync(outPaths.webmHigh + '.json', JSON.stringify(meta, null, 2));

  console.error(`Final High WebM size: ${meta.files.webmHigh} bytes`);
  console.log(JSON.stringify({ ...meta, ok: true, path: outputPath }));

  try { fs.rmSync(tempDir, { recursive: true }); } catch { }

} finally {
  await browser.close();
  try { fs.rmSync(tempDir, { recursive: true }); } catch { }
}

// Trigger full Spine export matrix after the workflow fix.
