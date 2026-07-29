#!/usr/bin/env node

import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

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
  animDuration: 0,
  alpha: false,
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
  else if (arg.startsWith('--branch=')) args.branch = arg.split('=')[1];
  else if (arg.startsWith('--anim-duration=')) args.animDuration = parseFloat(arg.split('=')[1]) || 0;
  else if (arg === '--alpha') args.alpha = true;
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
      const versionEnd = buffer.indexOf(0);
      if (versionEnd > 0) return buffer.toString('utf8', 0, versionEnd).trim();
      return buffer.toString('utf8', 0, Math.min(buffer.length, 80)).split('\0')[0].trim();
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
      // Binary .skel header layout (Spine 4.x):
      //   - length-prefixed version string
      //   - hash string, x, y, width, height (all floats after strings)
      // We do a heuristic: read the JSON skeleton metadata if a .json sibling exists,
      // otherwise fall back to 0x0 (the script will use a safe default).
      const dir = path.dirname(filePath);
      const base = path.basename(filePath, '.skel');
      const jsonSibling = path.join(dir, base + '.json');
      if (fs.existsSync(jsonSibling)) {
        const content = JSON.parse(fs.readFileSync(jsonSibling, 'utf8'));
        const w = Number(content?.skeleton?.width) || 0;
        const h = Number(content?.skeleton?.height) || 0;
        return { width: w, height: h };
      }
      // For .skel without a JSON sibling, return 0x0 — the browser will measure it live
      return { width: 0, height: 0 };
    }
  } catch { }
  return { width: 0, height: 0 };
}

const skeletonFilePath = path.join(firstSet.path, skeletonFile);
const skeletonVersion = detectSkeletonVersion(skeletonFilePath);
const skeletonBounds = readSkeletonBounds(skeletonFilePath);
const targetAnimation = args.animation || entry.defaultAnimation || '';

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

const atlasLocalPath = path.join(firstSet.path, atlasFile);
let atlasContent = fs.readFileSync(atlasLocalPath, 'utf8');
atlasContent = atlasContent.replace(/^\.\.[\\/\\]textures[\\/\\]/gm, '');

// --- Spine binary patcher ---
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
  // Defensive: recalculate exact output length
  const nextLength = sorted.reduce((length, replacement) => length - (replacement.end - replacement.start) + replacement.bytes.length, bytes.length);
  if (nextLength < 0) return bytes; // sanity guard
  const nextBytes = new Uint8Array(nextLength);
  let sourceIndex = 0, targetIndex = 0;
  for (const replacement of sorted) {
    const prefix = bytes.slice(sourceIndex, replacement.start);
    if (targetIndex + prefix.length > nextLength) return bytes; // bounds guard
    nextBytes.set(prefix, targetIndex);
    targetIndex += prefix.length;
    if (targetIndex + replacement.bytes.length > nextLength) return bytes; // bounds guard
    nextBytes.set(replacement.bytes, targetIndex);
    targetIndex += replacement.bytes.length;
    sourceIndex = replacement.end;
  }
  const tail = bytes.slice(sourceIndex);
  if (targetIndex + tail.length > nextLength) return bytes; // bounds guard
  nextBytes.set(tail, targetIndex);
  return nextBytes;
}

function sanitizedSkelBuffer(buffer, version = "") {
  const bytes = new Uint8Array(buffer);
  
  if (/^3\./.test(version)) {
    const patchCursor = new SpineBinaryCursor(new Uint8Array(bytes));
    try {
      patchCursor.readStringMeta(); // skip hash
      patchCursor.readStringMeta(); // skip version
      patchCursor.skip(8);          // skip w, h floats (Spine 3.8)
      const nonessential = patchCursor.readByte() !== 0;
      if (nonessential) {
        patchCursor.skip(4);        // skip fps
        const imagesPathPos = patchCursor.index;
        if (bytes[imagesPathPos] === 0x00) bytes[imagesPathPos] = 0x01;
        patchCursor.readStringMeta(); // skip imagesPath
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
    for (let index = 0; index < stringCount; index += 1) cursor.readStringMeta();

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
    // All parsing succeeded — apply replacements inside try so any crash is caught
    return Buffer.from(replaceByteRanges(bytes, replacements));
  } catch {
    // Parsing failed or replaceByteRanges crashed — return original bytes unmodified
    // (imagesPath/audioPath were already patched in-place above, so they're still fixed)
    return Buffer.from(bytes);
  }
}
// --- end Spine binary patcher ---


const isDefault = args.animation && args.defaultAnimation && args.animation === args.defaultAnimation;

console.error(`Entry: ${args.uploadId}`);
console.error(`Set: ${firstSet.name}`);
console.error(`Skeleton: ${skeletonFile} (v${skeletonVersion})`);
console.error(`Skeleton bounds: ${rawSkelWidth}x${rawSkelHeight}`);
console.error(`Video dimensions: ${videoWidth}x${videoHeight}`);
console.error(`Atlas: ${atlasFile}`);
console.error(`Animation: ${targetAnimation}`);
console.error(`Is default: ${isDefault}`);

const captureHtml = `<!DOCTYPE html>
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
  window.__animWidth = 0;
  window.__animHeight = 0;
  window.__ready = false;

  var player;
  var config = {
    ${skeletonKey === 'skelUrl' ? `skelUrl: '${skeletonRawUrl}'` : `skeleton: '${skeletonRawUrl}'`},
    atlas: '${atlasRawUrl}',
    textures: ${JSON.stringify(textureRawUrls)},
    animation: '${targetAnimation}',
    showLoading: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: true,
    alpha: true,
    backgroundColor: '${args.alpha ? '#00000000' : '#050607'}',
    viewport: { padLeft: '0%', padRight: '0%', padTop: '0%', padBottom: '0%' },
    resize: function () {
      try {
        if (player && player.skeleton) {
          player.animationState.apply(player.skeleton);
          player.skeleton.updateWorldTransform();
          var bounds = new spine.SkeletonBounds();
          bounds.update(player.skeleton, true);
          if (bounds.size.x > 0 && bounds.size.y > 0) {
            window.__animWidth = bounds.size.x;
            window.__animHeight = bounds.size.y;
          }
        }
      } catch (e) {}
    },
    success: function (p) {
      player = p;
      try {
        // Measure ACTUAL animation bounds, not editor skeleton size
        if (player.skeleton) {
          // Apply current animation to get bounds
          player.animationState.apply(player.skeleton);
          player.skeleton.updateWorldTransform();
          
          var bounds = new spine.SkeletonBounds();
          bounds.update(player.skeleton, true);
          
          if (bounds.size.x > 0 && bounds.size.y > 0) {
            window.__animWidth = bounds.size.x;
            window.__animHeight = bounds.size.y;
          } else {
            // Fallback to skeleton data bounds
            window.__animWidth = player.skeleton.data.width || 0;
            window.__animHeight = player.skeleton.data.height || 0;
          }
        }
        var track = player.animationState ? player.animationState.getCurrent(0) : null;
        if (track && track.animation && typeof track.animation.duration === 'number') {
          window.__animDuration = track.animation.duration;
        }
      } catch (e) {
        console.error('Bounds measurement failed:', e);
      }
      window.__ready = true;
    },
    error: function (p, err) {
      window.__captureError = 'Player creation failed: ' + err;
    }
  };

  // Start recording ONLY AFTER viewport is resized by Playwright
  window.__startRecording = function() {
    if (!player || !player.canvas) {
       window.__captureError = 'No canvas available to record';
       return;
    }
    try {
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
    } catch(err) {
       window.__captureError = 'MediaRecorder failed: ' + err.message;
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
    new spine.SpinePlayer("player", config);
  } catch(e) {
    if (e.message && e.message.includes('not a function')) {
      window.__captureError = 'spine.SpinePlayer is not a function';
    } else {
      window.__captureError = 'Player creation failed: ' + (e.message || e);
    }
  }
})();
</script>
</body>
</html>`;

const tempDir = path.join('/tmp', `spine-export-${Date.now()}`);
fs.mkdirSync(tempDir, { recursive: true });

const browser = await chromium.launch({
  headless: true,
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
      body = sanitizedSkelBuffer(rawBuffer, skeletonVersion);
    } else {
      body = fs.readFileSync(skeletonFilePath, 'utf8');
    }
    await route.fulfill({
      status: 200,
      contentType: skeletonFile.toLowerCase().endsWith('.skel') ? 'application/octet-stream' : 'application/json',
      body: body,
    });
  });

  await page.setContent(captureHtml, { waitUntil: 'networkidle', timeout: 60000 });

  let error = null;
  try {
    await page.waitForFunction(() => window.__ready === true || window.__captureError, { timeout: 60000, polling: 200 });
    error = await page.evaluate(() => window.__captureError || null);
  } catch (err) {
    error = err.message;
  }

  if (error) {
    console.error(`Capture failed: ${error}`);
    fs.writeFileSync(args.output + '.json', JSON.stringify({ error: error }, null, 2));
    process.exit(0);
  }

  let animDuration = await page.evaluate(() => window.__animDuration || 0);
  let canvasWidth = await page.evaluate(() => window.__animWidth || 0);
  let canvasHeight = await page.evaluate(() => window.__animHeight || 0);
  
  // Wait for first frame to render, then re-measure bounds
  await new Promise(resolve => setTimeout(resolve, 500));
  
  // Re-measure bounds after first frame renders
  const measuredBounds = await page.evaluate(() => {
    if (!player || !player.skeleton) return null;
    try {
      player.animationState.apply(player.skeleton);
      player.skeleton.updateWorldTransform();
      var bounds = new spine.SkeletonBounds();
      bounds.update(player.skeleton, true);
      return { width: bounds.size.x, height: bounds.size.y };
    } catch(e) {
      return null;
    }
  });
  
  if (measuredBounds && measuredBounds.width > 0 && measuredBounds.height > 0) {
    canvasWidth = measuredBounds.width;
    canvasHeight = measuredBounds.height;
    console.error(`Measured animation bounds: ${canvasWidth}x${canvasHeight}`);
  }
  
  if (canvasWidth > 0 && canvasHeight > 0) {
    // Calculate final dimensions
    const newW = (Math.min(MAX_VIDEO_DIM, Math.max(MIN_VIDEO_DIM, Math.round(canvasWidth))) & ~1);
    const newH = (Math.min(MAX_VIDEO_DIM, Math.max(MIN_VIDEO_DIM, Math.round(canvasHeight))) & ~1);
    
    // If the browser was initialized with wrong dimensions, we must resize AND recreate the player.
    // Resizing live crashes Spine 3.8, so we reload the page fresh.
    if (newW !== videoWidth || newH !== videoHeight) {
      console.error(`Viewport mismatch. Resizing from ${videoWidth}x${videoHeight} to ${newW}x${newH} and reloading player...`);
      await page.setViewportSize({ width: newW, height: newH });
      
      // Reload player completely fresh to avoid WebGL resize bugs
      await page.setContent(captureHtml, { waitUntil: 'networkidle', timeout: 60000 });
      try {
        await page.waitForFunction(() => window.__ready === true || window.__captureError, { timeout: 60000, polling: 200 });
        error = await page.evaluate(() => window.__captureError || null);
      } catch (err) {
        error = err.message;
      }
      
      if (error) {
        console.error(`Capture failed after reload: ${error}`);
        fs.writeFileSync(args.output + '.json', JSON.stringify({ error: error }, null, 2));
        process.exit(0);
      }
      
      // Re-read duration just in case
      animDuration = await page.evaluate(() => window.__animDuration || 0);
    }
    canvasWidth = newW;
    canvasHeight = newH;
  } else {
    canvasWidth = videoWidth;
    canvasHeight = videoHeight;
  }
  
  // Wait a moment for rendering to settle
  await new Promise(resolve => setTimeout(resolve, 500));

  // Now start recording
  await page.evaluate(() => window.__startRecording());

  console.error(`Animation ready, duration=${animDuration}s, canvas=${canvasWidth}x${canvasHeight}`);

  const captureDuration = animDuration > 0 ? animDuration : 1; // Exactly animDuration, no stretching/padding
  await new Promise(resolve => setTimeout(resolve, captureDuration * 1000));

  await page.evaluate(() => {
    if (window.__stopRecording) window.__stopRecording();
  });

  const videoDataUrl = await page.waitForFunction(() => window.__videoData, { timeout: 15000 }).then(h => h.jsonValue());
  if (!videoDataUrl) {
    console.error('No video data captured by MediaRecorder');
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

  const bitrates = { high: '1200k', medium: '350k', low: '150k' };
  
  const finalWidth = canvasWidth & ~1;
  const finalHeight = canvasHeight & ~1;

  // Calculate scaled dimensions (keeping aspect ratio, ensuring even numbers)
  function calcScale(maxWidth) {
    if (finalWidth <= maxWidth) return `${finalWidth}x${finalHeight}`;
    const scale = maxWidth / finalWidth;
    let newWidth = maxWidth;
    let newHeight = Math.round(finalHeight * scale);
    return `${newWidth & ~1}x${newHeight & ~1}`;
  }
  
  const dimHigh = `${finalWidth}x${finalHeight}`;
  const dimMedium = calcScale(1080);
  const dimLow = calcScale(360);

  try {
    const { execSync } = await import('child_process');
    console.error(`Running ffmpeg to generate multiple qualities...`);
    
    // WebM Generation
    const pixFmt = args.alpha ? 'yuva420p' : 'yuv420p';
    const alphaExtra = args.alpha ? '-auto-alt-ref 0' : '';
    // High Quality
    execSync(`ffmpeg -y -i "${videoPath}" -r 30 -s ${dimHigh} -c:v libvpx-vp9 -b:v ${bitrates.high} -pix_fmt ${pixFmt} ${alphaExtra} "${outPaths.webmHigh}"`, { stdio: 'inherit' });
    // Medium Quality
    execSync(`ffmpeg -y -i "${videoPath}" -r 30 -s ${dimMedium} -c:v libvpx-vp9 -b:v ${bitrates.medium} -pix_fmt ${pixFmt} ${alphaExtra} "${outPaths.webmMedium}"`, { stdio: 'inherit' });
    // Low Quality
    execSync(`ffmpeg -y -i "${videoPath}" -r 30 -s ${dimLow} -c:v libvpx-vp9 -b:v ${bitrates.low} -pix_fmt ${pixFmt} ${alphaExtra} "${outPaths.webmLow}"`, { stdio: 'inherit' });

    // WebP Generation (extract first frame)
    // High Quality WebP
    execSync(`ffmpeg -y -i "${videoPath}" -vframes 1 -s ${dimHigh} -c:v libwebp -q:v 90 "${outPaths.webpHigh}"`, { stdio: 'inherit' });
    // Medium Quality WebP
    execSync(`ffmpeg -y -i "${videoPath}" -vframes 1 -s ${dimMedium} -c:v libwebp -q:v 85 "${outPaths.webpMedium}"`, { stdio: 'inherit' });
    // Low Quality WebP
    execSync(`ffmpeg -y -i "${videoPath}" -vframes 1 -s ${dimLow} -c:v libwebp -q:v 80 "${outPaths.webpLow}"`, { stdio: 'inherit' });

    console.error(`FFmpeg processing complete. Generated 3x WebM and 3x WebP.`);
  } catch (err) {
    console.error(`FFmpeg processing failed or skipped: ${err.message}`);
    // Fallback if ffmpeg fails: just copy the original capture to the main output
    if (!fs.existsSync(outPaths.webmHigh)) fs.copyFileSync(videoPath, outPaths.webmHigh);
  }

  function getFileSize(filePath) {
    return fs.existsSync(filePath) ? fs.statSync(filePath).size : 0;
  }

  const finalWebmBuffer = fs.existsSync(outPaths.webmHigh) ? fs.readFileSync(outPaths.webmHigh) : Buffer.from([]);
  
  const meta = {
    animation: targetAnimation,
    animationDuration: animDuration,
    capturedDuration: captureDuration,
    width: finalWidth,
    height: finalHeight,
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
  console.error(`Final High WebP size: ${meta.files.webpHigh} bytes`);
  console.error(`Video dimensions: ${finalWidth}x${finalHeight}`);
  console.log(JSON.stringify({ ...meta, ok: true, path: outputPath }));

  try { fs.rmSync(tempDir, { recursive: true }); } catch { }

} finally {
  await browser.close();
  try { fs.rmSync(tempDir, { recursive: true }); } catch { }
}