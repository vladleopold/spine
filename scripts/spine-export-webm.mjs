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
atlasContent = atlasContent.replace(/^\.\.[\/\\]textures[\/\\]/gm, '');

const isDefault = args.animation && args.defaultAnimation && args.animation === args.defaultAnimation;

console.error(`Entry: ${args.uploadId}`);
console.error(`Set: ${firstSet.name}`);
console.error(`Skeleton: ${skeletonFile} (v${skeletonVersion})`);
console.error(`Skeleton bounds: ${rawSkelWidth}x${rawSkelHeight}`);
console.error(`Video dimensions: ${videoWidth}x${videoHeight} (from bounds + ${PAD_RATIO * 100}% padding)`);
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
  var config = {
    ${skeletonKey === 'skelUrl' ? `skelUrl: '${skeletonRawUrl}'` : `skeleton: '${skeletonRawUrl}'`},
    atlas: '${atlasRawUrl}',
    textures: ${JSON.stringify(textureRawUrls)},
    animation: '${targetAnimation}',
    showLoading: false,
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
      
      try {
        var track = player.animationState ? player.animationState.getCurrent(0) : null;
        if (track && track.animation && typeof track.animation.duration === 'number') {
          window.__animDuration = track.animation.duration;
        }
      } catch (e) {}

      // Force 30 FPS playback by overriding requestAnimationFrame for the player?
      // Not strictly necessary if we capture at 30fps and record for exact duration,
      // but let's record using MediaRecorder.
      if (player.canvas) {
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
      }
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
  await page.setContent(captureHtml, { waitUntil: 'networkidle', timeout: 60000 });

  let error = null;
  try {
    await page.waitForFunction(() => window.__ready === true || window.__captureError, { timeout: 60000, polling: 200 });
    error = await page.evaluate(() => window.__captureError || null);
  } catch (e) {
    error = e.message;
  }

  if (error) {
    console.error(`Capture failed: ${error}`);
    fs.writeFileSync(outPaths.metadata, JSON.stringify({ error: error }, null, 2));
    process.exit(0);
  }

  const animDuration = await page.evaluate(() => window.__animDuration || 0);
  const canvasWidth = await page.evaluate(() => window.__canvasWidth || 0) || videoWidth;
  const canvasHeight = await page.evaluate(() => window.__canvasHeight || 0) || videoHeight;

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
    execSync(`ffmpeg -y -i "${videoPath}" -r 30 -s ${dimHigh} -c:v libvpx-vp9 -b:v ${bitrates.high} -pix_fmt yuv420p "${outPaths.webmHigh}"`, { stdio: 'inherit' });
    // Medium Quality
    execSync(`ffmpeg -y -i "${videoPath}" -r 30 -s ${dimMedium} -c:v libvpx-vp9 -b:v ${bitrates.medium} -pix_fmt yuv420p "${outPaths.webmMedium}"`, { stdio: 'inherit' });
    // Low Quality
    execSync(`ffmpeg -y -i "${videoPath}" -r 30 -s ${dimLow} -c:v libvpx-vp9 -b:v ${bitrates.low} -pix_fmt yuv420p "${outPaths.webmLow}"`, { stdio: 'inherit' });

    // WebP Generation (extract first frame)
    // High Quality WebP
    execSync(`ffmpeg -y -i "${videoPath}" -vframes 1 -s ${dimHigh} -c:v libwebp "${outPaths.webpHigh}"`, { stdio: 'inherit' });
    // Medium Quality WebP
    execSync(`ffmpeg -y -i "${videoPath}" -vframes 1 -s ${dimMedium} -c:v libwebp "${outPaths.webpMedium}"`, { stdio: 'inherit' });
    // Low Quality WebP
    execSync(`ffmpeg -y -i "${videoPath}" -vframes 1 -s ${dimLow} -c:v libwebp "${outPaths.webpLow}"`, { stdio: 'inherit' });

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