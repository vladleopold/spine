#!/usr/bin/env node

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { trimBlackLead } from './lib/black-lead.mjs';

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
};

for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg.startsWith('--upload-id=')) args.uploadId = arg.split('=')[1];
  else if (arg.startsWith('--origin=')) args.origin = arg.split('=')[1];
  else if (arg.startsWith('--animation=')) args.animation = arg.split('=')[1];
  else if (arg.startsWith('--default-animation=')) args.defaultAnimation = arg.split('=')[1];
  else if (arg.startsWith('--output=')) args.output = arg.split('=')[1];
  else if (arg.startsWith('--repo-path=')) args.repoPath = arg.split('=')[1];
  else if (arg.startsWith('--base-path=')) args.basePath = arg.split('=')[1];
  else if (arg.startsWith('--owner=')) args.owner = arg.split('=')[1];
  else if (arg.startsWith('--repo=')) args.repo = arg.split('=')[1];
  else if (arg.startsWith('--github-token=')) args.githubToken = arg.split('=')[1];
  else if (arg.startsWith('--sanitize-skel=')) args.sanitizeSkel = arg.split('=')[1] !== 'false';
}

if (!args.uploadId) {
  console.error('Usage: spine-export-webm.mjs --upload-id=<id> --animation=<name> [options]');
  process.exit(1);
}

const repoRoot = path.resolve(args.repoPath);
const indexPath = path.join(repoRoot, args.basePath, 'index.json');
if (!fs.existsSync(indexPath)) {
  console.error(`Index not found at ${indexPath}`);
  process.exit(1);
}

const indexEntries = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
const entry = indexEntries.find(e => e.id === args.uploadId);
if (!entry) {
  console.error(`Entry ${args.uploadId} not found in index`);
  process.exit(1);
}

const uploadPath = entry.previewPath || path.posix.join(args.basePath, args.uploadId);

function findSetDirectories(baseDir) {
  const results = [];
  try {
    const entries = fs.readdirSync(baseDir, { withFileTypes: true });
    for (const dirent of entries) {
      if (!dirent.isDirectory()) continue;
      const dirPath = path.join(baseDir, dirent.name);
      try {
        const files = fs.readdirSync(dirPath);
        const hasSkeleton = files.some(f => /\.(json|skel)$/i.test(f));
        const hasAtlas = files.some(f => /\.(atlas|atlas\.txt|atlas\.docx)$/i.test(f));
        const hasImage = files.some(f => /\.(png|jpg|jpeg|webp)$/i.test(f));
        if (hasSkeleton && hasAtlas && hasImage) {
          results.push({ name: dirent.name, path: dirPath });
        }
      } catch { }
    }
  } catch { }
  return results;
}

const previewDir = path.join(repoRoot, uploadPath);
const sets = findSetDirectories(previewDir);

if (sets.length === 0) {
  console.error(`No Spine sets found in ${previewDir}`);
  process.exit(1);
}

const firstSet = sets[0];
const setFiles = fs.readdirSync(firstSet.path);
const skeletonFile = setFiles.find(f => /\.(json|skel)$/i.test(f));
const atlasFile = setFiles.find(f => /\.(atlas|atlas\.txt|atlas\.docx)$/i.test(f));
const textureFiles = setFiles.filter(f => /\.(png|jpg|jpeg|webp)$/i.test(f));

if (!skeletonFile || !atlasFile || textureFiles.length === 0) {
  console.error(`Set ${firstSet.name} is missing required files`);
  process.exit(1);
}

function detectSkeletonVersion(filePath) {
  try {
    const ext = path.extname(filePath).toLowerCase();
    if (ext === '.json') {
      const content = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      return String(content?.skeleton?.spine || '').trim();
    }
    if (ext === '.skel') {
      const buffer = fs.readFileSync(filePath);
      const bytes = new Uint8Array(buffer);
      let idx = 0;
      function readInt() {
        let byte = bytes[idx++];
        let result = byte & 0x7f;
        if ((byte & 0x80) !== 0) {
          byte = bytes[idx++]; result |= (byte & 0x7f) << 7;
          if ((byte & 0x80) !== 0) {
            byte = bytes[idx++]; result |= (byte & 0x7f) << 14;
            if ((byte & 0x80) !== 0) {
              byte = bytes[idx++]; result |= (byte & 0x7f) << 21;
              if ((byte & 0x80) !== 0) {
                byte = bytes[idx++]; result |= (byte & 0x7f) << 28;
              }
            }
          }
        }
        return result;
      }
      function readString() {
        const byteCount = readInt();
        if (byteCount <= 1) return '';
        const start = idx;
        idx += byteCount - 1;
        return new TextDecoder().decode(bytes.slice(start, idx));
      }
      readString();
      const version = readString();
      return version.trim() || '4.0';
    }
  } catch { }
  return '4.0';
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

const rawSkelWidth = skeletonBounds.width;
const rawSkelHeight = skeletonBounds.height;

// Add padding to skeleton bounds; fall back to 960x720 if bounds unknown
const rawVideoWidth = rawSkelWidth > 0 ? rawSkelWidth * (1 + PAD_RATIO * 2) : 960;
const rawVideoHeight = rawSkelHeight > 0 ? rawSkelHeight * (1 + PAD_RATIO * 2) : 720;

// Clamp to min/max and ensure even dimensions (required by video codecs)
const videoWidth = (Math.min(MAX_VIDEO_DIM, Math.max(MIN_VIDEO_DIM, Math.round(rawVideoWidth))) & ~1) || 960;
const videoHeight = (Math.min(MAX_VIDEO_DIM, Math.max(MIN_VIDEO_DIM, Math.round(rawVideoHeight))) & ~1) || 720;

const versionMajor = skeletonVersion.split('.')[0] || '4';
const isLegacy = parseInt(versionMajor, 10) < 4;
const runtimeMinor = isLegacy ? (skeletonVersion.split('.')[1] || '8') : '';

// Use reliable Vercel domain for legacy player assets to avoid DNS resolution issues in GitHub Actions
const stableOrigin = 'https://spine-link.vercel.app';
const playerJsUrl = isLegacy
  ? `${stableOrigin}/vendor-spine-player-${versionMajor}.${runtimeMinor}.js`
  : 'https://cdn.jsdelivr.net/npm/@esotericsoftware/spine-player@4.3.13/dist/iife/spine-player.js';
const playerCssUrl = isLegacy
  ? `${stableOrigin}/vendor-spine-player-${versionMajor}.${runtimeMinor}.css`
  : 'https://cdn.jsdelivr.net/npm/@esotericsoftware/spine-player@4.3.13/dist/spine-player.css';

const skeletonKey = skeletonFile.toLowerCase().endsWith('.skel') ? 'skelUrl' : 'skeleton';
const atlasKey = 'atlas';

const setSegments = [uploadPath, firstSet.name];

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
    const warmupHtml = `<!DOCTYPE html><html><head><meta charset="UTF-8"><link rel="stylesheet" href="${playerCssUrl}"><style>*{margin:0;padding:0;box-sizing:border-box}html,body{width:100%;height:100%;background:transparent;overflow:hidden}#player{width:100%;height:100%}</style></head><body><div id="player"></div><script src="${playerJsUrl}"></script><script>(function(){window.__warmup=null;var cfg={${legacy ? (skelKey==='skelUrl'?'skelUrl':'jsonUrl')+':\''+skelUrl+'\'' : skelKey+':\''+skelUrl+'\''},${legacy?'atlasUrl':'atlas'}:'${atlasUrl}',textures:${texUrls},showLoading:false,premultipliedAlpha:false,preserveDrawingBuffer:true,alpha:true,backgroundColor:'#00000000',success:function(p){window.__warmup=p;},error:function(p,e){window.__warmupError=e;}};try{if(typeof spine.SpinePlayer==='function'){new spine.SpinePlayer('player',cfg);}else{window.__warmupError='spine.SpinePlayer is not a function';}}catch(e){window.__warmupError=e.message||e;}})();</script></body></html>`;
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
const scenarioCycle = scenarioEntry && scenarioExit ? [scenarioEntry, scenarioIdle, scenarioIdle, scenarioExit].filter(Boolean) : [];
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
const skinLine = activeSkin ? `    skin: '${activeSkin}',\n` : '';
return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<link rel="stylesheet" href="${playerCssUrl}">
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: 100%; height: 100%; background: #050607; overflow: hidden; }
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
      var sw = Math.min(w, 160), sh = Math.min(h, 160);
      var x = (w - sw) >> 1, y = (h - sh) >> 1;
      var buf = new Uint8Array(sw * sh * 4);
      g.readPixels(x, y, sw, sh, g.RGBA, g.UNSIGNED_BYTE, buf);
      var mx = 0;
      for (var i = 0; i < buf.length; i += 4) {
        var m = Math.max(buf[i], buf[i + 1], buf[i + 2]);
        if (m > mx) mx = m;
      }
      return mx;
    } catch (e) { return -1; }
  };
  var config = {
    ${isLegacy ? (skeletonKey === 'skelUrl' ? `skelUrl: '${skeletonRawUrl}'` : `jsonUrl: '${skeletonRawUrl}'`) : (skeletonKey === 'skelUrl' ? `skelUrl: '${skeletonRawUrl}'` : `skeleton: '${skeletonRawUrl}'`)},
    ${isLegacy ? `atlasUrl: '${atlasRawUrl}'` : `atlas: '${atlasRawUrl}'`},
    textures: ${JSON.stringify(textureRawUrls)},
    animation: '${captureAnimation}',
    scenario: ${JSON.stringify(scenarioCycle)},
    __spineScenario: ${JSON.stringify(scenarioCycle)},
${skinLine}    showLoading: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: true,
    alpha: true,
    backgroundColor: '#050607',
    viewport: { padLeft: '0%', padRight: '0%', padTop: '0%', padBottom: '0%' },
    success: function (p) {
      player = p;
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

      try {
        var track = player.animationState ? player.animationState.getCurrent(0) : null;
        if (track && track.animation && typeof track.animation.duration === 'number') {
          window.__animDuration = track.animation.duration;
        }
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
          var stream = player.canvas.captureStream(30);
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
  let captureDuration = 1;
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

    // Start recording only now, on the settled canvas showing content.
    const recState = await page.evaluate(() => (typeof window.__startRecording === 'function' ? window.__startRecording() : 'missing'));
    console.error(`Skin ${label}: recorder ${recState}`);
    if (recState !== 'recording') {
      lastCaptureError = `MediaRecorder failed to start (${recState})`;
      console.error(`Capture with skin ${label} failed: ${lastCaptureError}`);
      break;
    }

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
    if (captureDuration <= 0) captureDuration = effectiveDuration > 0 ? effectiveDuration : 1; // Record exactly the animation duration (no artificial minimum)
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
      lastCaptureError = 'No video data captured by MediaRecorder';
      console.error(`Capture with skin ${label} failed: ${lastCaptureError}`);
      break;
    }
    chosenSkin = skin;
    console.error(`Capture skin: ${label} (peak ${framePeak})`);
    break;
  }

  if (!videoDataUrl) {
    console.error(`Capture failed: ${lastCaptureError || 'no skin produced visible content'}`);
    process.exit(1);
  }

  const base64Data = videoDataUrl.split(',')[1];
  const webmBuffer = Buffer.from(base64Data, 'base64');
  
  const videoPath = path.join(tempDir, 'browser-recording.webm');
  fs.writeFileSync(videoPath, webmBuffer);

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
  const leadResult = trimBlackLead(outputPath, {
    label: path.basename(outputPath),
    log: (line) => console.error(line),
  });
  if (leadResult.trimmed) {
    console.error(`Black lead trimmed: ${leadResult.cut} frame(s) removed before export`);
  }

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

  // Битрейт считаем от числа пикселей кадра. Раньше стояло фиксированное
  // 1200k, а на кадре 1644x1612 это меньше половины бита на пиксель —
  // картинка рассыпается, и это выглядит как низкий фреймрейт.
  const pixels = videoWidth * videoHeight;
  const bitrateFor = (bitsPerPixel) => {
    const kbps = Math.round((pixels * bitsPerPixel) / 1000);
    return `${Math.max(450, Math.min(6000, kbps))}k`;
  };
  const bitrates = { high: bitrateFor(120), medium: bitrateFor(60), low: bitrateFor(28) };
  
  // Calculate scaled dimensions (keeping aspect ratio, ensuring even numbers)
  function calcScale(maxWidth) {
    if (videoWidth <= maxWidth) return `${videoWidth}x${videoHeight}`;
    const scale = maxWidth / videoWidth;
    let newWidth = maxWidth;
    let newHeight = Math.round(videoHeight * scale);
    return `${newWidth & ~1}x${newHeight & ~1}`;
  }
  
  const dimHigh = `${videoWidth}x${videoHeight}`;
  const dimMedium = calcScale(1080);
  const dimLow = calcScale(360);

  try {
    const { execSync } = await import('child_process');
    console.error(`Running ffmpeg to generate multiple qualities...`);
    
    // WebM Generation
    // High Quality
    // deadline=realtime заставляет кодировщик выдать все кадры: при
    // deadline=good он часть просто отбрасывает, и анимация идёт рывками.
    // lag-in-frames 0 убирает задержку между кадрами на выходе.
    const vp9 = (dim, bitrate, out) =>
      `ffmpeg -y -i "${videoPath}" -r 30 -s ${dim} -c:v libvpx-vp9 -b:v ${bitrate} ` +
      `-pix_fmt yuv420p -deadline realtime -cpu-used 8 -lag-in-frames 0 ` +
      `-auto-alt-ref 0 -row-mt 1 -g 30 -threads 4 "${out}"`;

    // High Quality
    execSync(vp9(dimHigh, bitrates.high, outPaths.webmHigh), { stdio: 'inherit' });
    // Medium Quality
    execSync(vp9(dimMedium, bitrates.medium, outPaths.webmMedium), { stdio: 'inherit' });
    // Low Quality
    execSync(vp9(dimLow, bitrates.low, outPaths.webmLow), { stdio: 'inherit' });

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
        let lit = 0;
        for (let i = 0; i < raw.length; i++) if (raw[i] > 24) lit++;
        return lit >= 24 && lit / raw.length >= 0.02;
      } catch (e) {
        return false;
      }
    }

    function pickPosterFrame(source, pngPath) {
      for (const ss of [0, 0.15, 0.35, 0.6, 0.9]) {
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
        try {
          execSync(`cwebp -quiet "${pngPath}" -o "${out}"`, { stdio: 'inherit' });
        } catch (e) {
          execSync(`convert "${pngPath}" "${out}"`, { stdio: 'inherit' });
        }
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
    if (!fs.existsSync(outPaths.webmHigh)) fs.copyFileSync(outputPath, outPaths.webmHigh);
  }

  function getFileSize(filePath) {
    return fs.existsSync(filePath) ? fs.statSync(filePath).size : 0;
  }

  const finalWebmBuffer = fs.existsSync(outPaths.webmHigh) ? fs.readFileSync(outPaths.webmHigh) : Buffer.from([]);
  
  const meta = {
    animation: targetAnimation,
    skin: chosenSkin === null ? 'default' : chosenSkin,
    animationDuration: effectiveDuration,
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