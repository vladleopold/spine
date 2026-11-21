#!/usr/bin/env node

import { execFileSync } from 'node:child_process';
import { chooseAtlasForSkeleton, reconcileDdsAtlasPages, reconcileAtlasPageReferences } from "./atlas-pages.mjs";
import { shouldUseCanvasFallback, fallbackFrameCount } from "./lib/canvas-fallback.mjs";
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { trimBlackLead } from './lib/black-lead.mjs';
import { collectionPathForUpload, entryForUpload } from './resolve-library.mjs';
import { detectSkeletonVersion } from './spine-version-detect.mjs';
import {prepareBinaryJsonSkeletonAliases} from './lib/spine-binary-json-alias.mjs';
import { choosePreviewAnimation } from './preview-animation-choice.mjs';
import { hasVisibleScreenshotPixels } from './lib/preview-visibility-recovery.mjs';
import { resolveLocalSpinePlayerAssets } from './lib/spine-player-runtime-assets.mjs';
import { generateFirstFrameWebp } from './lib/first-frame-poster.mjs';
import { chooseSourceSkeleton } from './source-skeleton-choice.mjs';
import { chooseSourceSet } from './lib/source-set-choice.mjs';
import { spinePlayerSourceBlocker } from './lib/spine-player-source-support.mjs';

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
// The source upload is immutable. Create a byte-identical temporary .skel
// alias only when the misnamed .json has a genuine Spine binary header.
const removeTemporaryBinaryAliases=prepareBinaryJsonSkeletonAliases(previewDir);
process.once('exit',removeTemporaryBinaryAliases);
const sets = findSetDirectories(previewDir);

if (sets.length === 0) {
  console.error(`No Spine sets found in ${previewDir}`);
  process.exit(1);
}

const requestedSkeleton = String(entry.skeleton || entry.skeletonFile || '');
const firstSet = chooseSourceSet(sets, requestedSkeleton, (set) => fs.readdirSync(set.path));
if (!firstSet) {
  console.error(requestedSkeleton
    ? 'REQUESTED_SOURCE_SET_MISSING_OR_AMBIGUOUS'
    : 'AMBIGUOUS_SOURCE_SKELETON_SET');
  process.exit(1);
}
const setFiles = fs.readdirSync(firstSet.path);
const isValidJsonSkeleton = file => {
  if (!/\.json$/i.test(file)) return false;
  try { return Array.isArray(JSON.parse(fs.readFileSync(path.join(firstSet.path, file), 'utf8')).bones); }
  catch { return false; }
};
let skeletonFile;
try {
  skeletonFile = chooseSourceSkeleton(requestedSkeleton, setFiles, isValidJsonSkeleton);
} catch (error) {
  console.error(error.message);
  process.exit(1);
}
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
const availableAnimations = readAnimationNames(skeletonFilePath);
const indexedAnimation = typeof entry.defaultAnimation === 'string' ? entry.defaultAnimation : '';
const requestedAnimation = args.animation !== '' ? args.animation : indexedAnimation;
const targetAnimation = choosePreviewAnimation(availableAnimations, requestedAnimation);
if (!targetAnimation) {
  console.error('NO_DEFAULT_SPINE_ANIMATION: refusing to guess a runtime track');
  process.exit(1);
}
if (availableAnimations.length && !availableAnimations.includes(targetAnimation)) {
  console.error('SELECTED_SPINE_ANIMATION_UNAVAILABLE');
  process.exit(1);
}
if (skeletonVersion === 'unknown') {
  console.error('SPINE_VERSION_UNKNOWN: cannot select a compatible player runtime for this skeleton');
  process.exit(1);
}
if (skeletonVersion === '3.8.75') {
  console.error('UNSUPPORTED_SPINE_EXPORT_3_8_75: official 3.8 runtime rejects this exported skeleton format; source re-export required');
  process.exit(1);
}

const sourceBlocker = spinePlayerSourceBlocker(skeletonVersion, skeletonFile);
if (sourceBlocker) {
  console.error(`${sourceBlocker.code}: ${sourceBlocker.message}`);
  process.exit(1);
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
const textureMetadata=textureFiles.map(name=>{
  let width=0,height=0;
  try{
    const fd=fs.openSync(path.join(firstSet.path,name),'r');
    try{
      const header=Buffer.alloc(24);
      if(fs.readSync(fd,header,0,24,0)===24&&
        header.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10]))){
        width=header.readUInt32BE(16);
        height=header.readUInt32BE(20);
      }
    }finally{fs.closeSync(fd);}
  }catch{}
  return {name,width,height};
});
const reconciledPages=reconcileAtlasPageReferences(atlasContent,textureMetadata);
atlasContent=reconciledPages.text;
if(reconciledPages.aliases||reconciledPages.unresolved)
  console.error('ATLAS_PAGE_RESOLUTION_COUNTS='+JSON.stringify({
    matched:reconciledPages.pages-reconciledPages.unresolved,
    aliases:reconciledPages.aliases,unresolved:reconciledPages.unresolved
  }));


const isDefault = args.animation && args.defaultAnimation && args.animation === args.defaultAnimation;

console.error(`Entry: ${args.uploadId}`);
console.error(`Set: ${firstSet.name}`);
console.error(`Skeleton: ${skeletonFile} (v${skeletonVersion})`);
console.error(`Skeleton bounds: ${rawSkelWidth}x${rawSkelHeight}`);
console.error(`Video dimensions: ${videoWidth}x${videoHeight} (from bounds + ${PAD_RATIO * 100}% padding)`);
console.error(`Atlas: ${atlasFile}`);
// Record one original Spine animation timeline only.
const captureAnimation = targetAnimation;
console.error(`Animation: ${captureAnimation}`);
console.error(`Is default: ${isDefault}`);

// Capture page builder. Keep the source/default skin unchanged. If it draws
// no visible content, the selected preview is blocked rather than relayered.
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
  // mark the selected preview as blocked. Requires preserveDrawingBuffer (set below).
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
      window.__selectedAnimation = ${JSON.stringify(captureAnimation)};
      if (window.__selectedAnimation && player.animationState) {
        player.animationState.clearTracks();
        player.animationState.setAnimation(0, window.__selectedAnimation, true);
      }
      window.__ready = true;
      window.__canvasWidth = player.canvas ? player.canvas.width : 0;
      window.__canvasHeight = player.canvas ? player.canvas.height : 0;
      
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
    // Modern headless Chrome requires ANGLE's SwiftShader backend and an
    // explicit opt-in for software WebGL. Without it, Spine Player can create
    // a player shell but WebGL VERSION is null and skeleton initialization
    // fails with `Cannot read properties of null (reading 'indexOf')`.
    '--use-gl=angle',
    '--use-angle=swiftshader',
    '--enable-unsafe-swiftshader',
    '--enable-webgl',
    '--ignore-gpu-blocklist',
    '--disable-gpu-sandbox',
    '--disable-features=Vulkan',
  ],
});

try {
  const context = await browser.newContext({
    viewport: { width: videoWidth, height: videoHeight },
    reducedMotion: 'no-preference',
  });
  const page = await context.newPage();
  const webglProbe = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    const gl = canvas.getContext('webgl2') || canvas.getContext('webgl');
    if (!gl) return { available: false, version: null };
    return { available: true, version: gl.getParameter(gl.VERSION),
      renderer: gl.getParameter(gl.RENDERER) };
  });
  if (!webglProbe.available || typeof webglProbe.version !== 'string' || !webglProbe.version)
    throw new Error('HEADLESS_WEBGL_UNAVAILABLE: ' + JSON.stringify(webglProbe));
  console.error('HEADLESS_WEBGL_READY ' + JSON.stringify(webglProbe));

  // Serve the exact matching runtime from the isolated pinned package. Never
  // mix a 4.3 runtime with the unversioned root node_modules path.
  const versionedRuntimeRoot = process.env.SPINE_VERSIONED_PLAYER_DIR || '';
  const localPlayerAssets = resolveLocalSpinePlayerAssets({
    isLegacy,
    versionedRuntimeRoot,
    modernRuntime,
    repoRoot,
    versionMajor,
    runtimeMinor,
    playerJsUrl,
    playerCssUrl,
  });
  for (const { url, filename, type, required } of localPlayerAssets) {
    if (!fs.existsSync(filename)) {
      console.error('LOCAL_SPINE_RUNTIME_MISSING ' + path.basename(filename));
      if (required) throw new Error('PINNED_SPINE_PLAYER_ASSET_MISSING_' + modernRuntime);
      continue;
    }
    await page.route(url, route => route.fulfill({
      status: 200, contentType: type, body: fs.readFileSync(filename),
    }));
    console.error('LOCAL_SPINE_RUNTIME_READY ' + path.basename(filename));
    if (required) console.error('VERSIONED_LOCAL_PLAYER_READY ' + modernRuntime);
  }

  page.on('console', msg => console.error(`[BROWSER ${msg.type()}] ${msg.text()}`));
  page.on('pageerror', err => console.error(`[BROWSER ERROR] ${err.stack || err.message}`));

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
  // Preserve the source skin. An invisible default skin is a blocked preview.
  const FRAME_PEAK_MIN = 40;
  const skinCandidates = Object.freeze([null]);

  let chosenSkin = null;
  let animDuration = 0;
  let effectiveDuration = 0;
  let captureDuration = 0;
  let canvasWidth = videoWidth;
  let canvasHeight = videoHeight;
  let videoDataUrl = null;
  let lastCaptureError = null;

  // WebGL readPixels sometimes returns an empty back buffer even when the
  // browser compositor draws the real skeleton. Confirm visible pixels from
  // a temporary on-screen canvas screenshot before declaring the art blank.
  async function hasVisibleCompositedCanvas() {
    try {
      const png=await page.locator('#player canvas').first().screenshot({type:'png',timeout:15000});
      const rgb=execFileSync('ffmpeg',[
        '-v','error','-f','image2pipe','-i','pipe:0',
        '-vf','scale=32:32','-f','rawvideo','-pix_fmt','rgb24','pipe:1'
      ],{input:png,timeout:20000,maxBuffer:32768});
      return hasVisibleScreenshotPixels(rgb);
    } catch { return false; }
  }

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

    // Stable, non-sensitive stage markers distinguish startup from later visibility failure.
    console.error('PLAYER_READY=1');
    console.error('SOURCE_SKIN_MODE=default');

    const runtimeAnimations = await page.evaluate(() => window.__animationNames || []);
    const pinnedAnimation = requestedAnimation;
    if (!runtimeAnimations.includes(pinnedAnimation)) {
      lastCaptureError = 'SELECTED_SPINE_ANIMATION_UNAVAILABLE';
      console.error('SELECTED_SPINE_ANIMATION_UNAVAILABLE');
      break;
    }
    if (!availableAnimations.length) availableAnimations.push(...runtimeAnimations);
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
    let framePeak = await page.evaluate(() => (typeof window.__framePeak === 'function' ? window.__framePeak() : -1));
    if(framePeak<FRAME_PEAK_MIN && await hasVisibleCompositedCanvas()) {
      framePeak=FRAME_PEAK_MIN;
      console.error('VISIBLE_COMPOSITED_SPINE_CANVAS');
    }
    // Some genuine animations start with hidden/faded attachments. A single
    // frame at ~1s is not enough to declare the SAME animation invisible.
    // Sample a bounded section of the existing timeline, never another name.
    if(framePeak<FRAME_PEAK_MIN) {
      const probeWindowMs=Math.min(3500,Math.max(1000,
        Math.round((effectiveDuration>0?effectiveDuration:2)*1000)));
      let probes=0;
      for(let sample=0;sample<6&&framePeak<FRAME_PEAK_MIN;sample++) {
        await new Promise(resolve=>setTimeout(resolve,probeWindowMs/6));
        probes++;
        framePeak=await page.evaluate(()=>
          typeof window.__framePeak==='function'?window.__framePeak():-1).catch(()=>-1);
        if(framePeak<FRAME_PEAK_MIN&&await hasVisibleCompositedCanvas())
          framePeak=FRAME_PEAK_MIN;
      }
      console.error('SAME_ANIMATION_VISIBILITY_PROBES='+probes+
        ' VISIBLE='+String(framePeak>=FRAME_PEAK_MIN));
    }
    // Never replace a requested/default animation with another animation.
    // An invisible original is a render failure, not permission to invent
    // a different timeline for the work.
    console.error(`Skin ${label}: frame peak=${framePeak}, canvas=${canvasWidth}x${canvasHeight}, duration=${animDuration}s`);
    if (framePeak < FRAME_PEAK_MIN) {
      lastCaptureError = 'No visible pixels from the selected default Spine skin';
      console.error('NO_VISIBLE_SPINE_FRAME');
      break;
    }

    // Preserve only the selected animation's own duration.
    captureDuration = effectiveDuration;
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
    // Rewind the SAME source animation so the recorded video starts at its
    // actual first key, rather than in the middle of the visibility probe.
    if(targetAnimation) {
      const reset=await page.evaluate(name=>{
        const p=window.__exportPlayer;
        if(!p?.animationState)return false;
        try {
          p.animationState.clearTracks();
          p.animationState.setAnimation(0,name,true);
          p.paused=false;
          return true;
        }catch{return false;}
      },targetAnimation);
      if(!reset)throw new Error('SELECTED_SPINE_ANIMATION_RESET_FAILED');
    }
    // Start recording only now, on the settled canvas showing content.
    const recState = await page.evaluate(() => (typeof window.__startRecording === 'function' ? window.__startRecording() : 'missing'));
    console.error(`Skin ${label}: recorder ${recState}`);
    if (recState !== 'recording') {
      lastCaptureError = `MediaRecorder failed to start (${recState})`;
      console.error(`Capture with skin ${label} failed: ${lastCaptureError}`);
      break;
    }

    console.error('RECORDER_STATE=recording');
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
      throw new Error(`Capture failed: ${lastCaptureError || 'selected default skin produced no visible content'}`);
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
    // A decodable, nonblank MediaRecorder clip can still contain almost no
    // changing frames when headless WebGL stalls. Reuse the exact strict motion
    // gate before accepting it; a failure routes through the same-animation
    // real-canvas capture below rather than weakening the acceptance threshold.
    const hasSufficientMotion = (filename) => {
      try {
        const output = execFileSync(process.execPath, [
          path.join(repoRoot, 'scripts/verify-preview-motion.mjs'), filename,
        ], { encoding: 'utf8', timeout: 120000, maxBuffer: 2 * 1024 * 1024 });
        if (output.trim()) console.error(output.trim());
        return true;
      } catch (error) {
        const detail = [error.stdout, error.stderr].map(value => String(value || '').trim())
          .filter(Boolean).join(' ');
        console.error('RECORDED_WEBM_MOTION_INCOMPLETE ' + detail);
        return false;
      }
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
    if (shortCapture || !encodedHasContent(videoPath, captureDuration) || !hasSufficientMotion(videoPath)) {
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
      console.error('CANVAS_FALLBACK_CAPTURE=started');
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
      console.error('CANVAS_FALLBACK_CAPTURE=passed');
      const recovered=path.join(tempDir,'deterministic.webm');
      execFileSync('ffmpeg',[
        '-y','-v','error','-framerate',String(frameCount/duration),
        '-i',path.join(framesDir,'%06d.png'),
        '-c:v','libvpx-vp9','-pix_fmt','yuv420p','-deadline','realtime',
        '-cpu-used','8','-threads','3','-auto-alt-ref','0',recovered,
      ],{stdio:'inherit'});
      if (!encodedHasContent(recovered,duration))
        throw new Error('Spine runtime generated blank deterministic frames; artwork requires native inspection');
      if (!hasSufficientMotion(recovered))
        throw new Error('Selected Spine animation still has insufficient distinct motion after real-canvas recovery');
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
    // Never label a copied high-quality source as medium/low. A tier that
    // cannot be encoded is a failed render, not permission to substitute quality.
    execSync(vp9(dimMedium, bitrates.medium, outPaths.webmMedium), { stdio: 'inherit' });
    execSync(vp9(dimLow, bitrates.low, outPaths.webmLow), { stdio: 'inherit' });

    // The WebP is frame zero of this exact quality-tier WebM. A black or
    // transparent opening frame is preserved; no later frame is substituted.
    function convertToWebp(source, out, dim) {
      try {
        generateFirstFrameWebp(source, out);
      } catch (err) {
        throw new Error(`WebP generation failed for ${out}: ${err.message}`);
      }
    }
    const webpDims = {
      high: dimHigh,
      medium: dimMedium,
      low: dimLow,
    };
    for (const q of ['high', 'medium', 'low']) {
      const webmSrc = outPaths[`webm${q[0].toUpperCase()}${q.slice(1)}`];
      const webpOut = outPaths[`webp${q[0].toUpperCase()}${q.slice(1)}`];
      convertToWebp(webmSrc, webpOut, webpDims[q]);
    }
    console.error(`All three WebP posters verified against their own WebM frame zero.`);
  } catch (err) {
    console.error(`FFmpeg processing failed or skipped: ${err.message}`);
    // A failed encoder or poster is a failed render. Never publish a
    // partial ladder or substitute a different frame/quality.
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
    qualityWidths: { high: widthOf(dimHigh), medium: widthOf(dimMedium), low: widthOf(dimLow) },
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
