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
  animDuration: 0,      // server-side pre-computed animation duration in seconds
  chunkDuration: 30,   // max seconds per chunk
  chunkIndex: -1,       // -1 = no chunking, 0/1/2... = which chunk
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
  else if (arg.startsWith('--anim-duration=')) args.animDuration = parseFloat(arg.split('=')[1]) || 0;
  else if (arg.startsWith('--chunk-duration=')) args.chunkDuration = parseFloat(arg.split('=')[1]) || 30;
  else if (arg.startsWith('--chunk-index=')) args.chunkIndex = parseInt(arg.split('=')[1], 10);
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

const skeletonFilePath = path.join(firstSet.path, skeletonFile);
const skeletonVersion = detectSkeletonVersion(skeletonFilePath);
const targetAnimation = args.animation || entry.defaultAnimation || '';

const versionMajor = skeletonVersion.split('.')[0] || '4';
const isLegacy = parseInt(versionMajor, 10) < 4;
const runtimeMinor = isLegacy ? (skeletonVersion.split('.')[1] || '8') : '';

const playerJsUrl = isLegacy
  ? `${args.origin}/vendor-spine-player-${versionMajor}.${runtimeMinor}.js`
  : 'https://cdn.jsdelivr.net/npm/@esotericsoftware/spine-player@4.3.13/dist/iife/spine-player.js';
const playerCssUrl = isLegacy
  ? `${args.origin}/vendor-spine-player-${versionMajor}.${runtimeMinor}.css`
  : 'https://cdn.jsdelivr.net/npm/@esotericsoftware/spine-player@4.3.13/dist/spine-player.css';

const skeletonKey = isLegacy ? 'jsonUrl' : 'skeleton';
const atlasKey = isLegacy ? 'atlasUrl' : 'atlas';

const setSegments = [uploadPath, firstSet.name];

// Read files from disk and encode as data URIs for rawDataURIs
function fileToDataUri(filePath, mimeType) {
  const buf = fs.readFileSync(filePath);
  return `data:${mimeType};base64,${buf.toString('base64')}`;
}

function mimeFor(filename) {
  const ext = path.extname(filename).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.json') return 'application/json';
  if (ext === '.atlas') return 'text/plain';
  if (ext === '.skel') return 'application/octet-stream';
  return 'application/octet-stream';
}

// Build rawDataURIs with all file data embedded as data: URIs
const rawDataURIs = {};
const allSetFiles = [skeletonFile, atlasFile, ...textureFiles];
for (const f of allSetFiles) {
  const filePath = path.join(firstSet.path, f);
  const dataUri = fileToDataUri(filePath, mimeFor(f));
  rawDataURIs[f] = dataUri;
  rawDataURIs[path.basename(f)] = dataUri;
}

// Also use rawUrl for fallback (if rawDataURIs not supported by this player version)
function rawUrl(filename) {
  return `${args.origin}/api/github-asset?path=${encodeURIComponent(setSegments.join('/') + '/' + filename)}`;
}
const skeletonRawUrl = rawUrl(skeletonFile);
const atlasRawUrl = rawUrl(atlasFile);

const isDefault = args.animation && args.defaultAnimation && args.animation === args.defaultAnimation;

console.error(`Entry: ${args.uploadId}`);
console.error(`Set: ${firstSet.name}`);
console.error(`Skeleton: ${skeletonFile} (v${skeletonVersion})`);
console.error(`Atlas: ${atlasFile}`);
console.error(`Animation: ${targetAnimation}`);
console.error(`Is default: ${isDefault}`);
console.error(`rawDataURIs keys: ${Object.keys(rawDataURIs).join(', ')}`);


const captureHtml = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<style>
* { margin: 0; padding: 0; box-sizing: border-box; }
html, body { width: 100%; height: 100%; background: #000000; overflow: hidden; }
#player { width: 1920px; height: 1080px; }
.spine-player-controls { display: none !important; }
.spine-player-loading { display: none !important; }
</style>
</head>
<body>
<div id="player"></div>
</body>
</html>`;

const initScript = `
(function() {
  window.__captureError = null;
  window.__animDuration = 0;
  window.__ready = false;

  var isLegacy = ${isLegacy};

  var config = {
    animation: ${JSON.stringify(targetAnimation)},
    showLoading: false,
    premultipliedAlpha: false,
    preserveDrawingBuffer: true,
    alpha: true,
    backgroundColor: '#000000',
    rawDataURIs: ${JSON.stringify(rawDataURIs)},
  };

  if (isLegacy) {
    config.${skeletonKey} = ${JSON.stringify(skeletonFile)};
    config.${atlasKey} = ${JSON.stringify(atlasFile)};
    config.success = function(widget) {
      if (widget.canvas) {
        widget.canvas.width = 1920;
        widget.canvas.height = 1080;
      }
      window.__ready = true;
      window.__canvasWidth = widget.canvas ? widget.canvas.width : 0;
      window.__canvasHeight = widget.canvas ? widget.canvas.height : 0;
      try {
        var track = widget.animationState ? widget.animationState.getCurrent(0) : null;
        if (track && track.animation && typeof track.animation.duration === 'number') {
          window.__animDuration = track.animation.duration;
        }
      } catch (e) {}
    };
    config.error = function(widget, msg) {
      window.__captureError = 'Player error: ' + (msg || 'unknown');
    };
  } else {
    config.${skeletonKey} = ${JSON.stringify(skeletonFile)};
    config.${atlasKey} = ${JSON.stringify(atlasFile)};
    config.success = function(player) {
      if (player.canvas) {
        player.canvas.width = 1920;
        player.canvas.height = 1080;
      }
      window.__ready = true;
      window.__canvasWidth = player.canvas ? player.canvas.width : 0;
      window.__canvasHeight = player.canvas ? player.canvas.height : 0;
      try {
        var track = player.animationState ? player.animationState.getCurrent(0) : null;
        if (track && track.animation && typeof track.animation.duration === 'number') {
          window.__animDuration = track.animation.duration;
        }
      } catch (e) {}
    };
    config.error = function(player, msg) {
      window.__captureError = 'Player error: ' + (msg || 'unknown');
    };
  }

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

  var player;
  try {
    player = new spine.SpinePlayer('player', config);
    window.__spinePlayer = player;
  } catch (e) {
    window.__captureError = 'Player creation failed: ' + e.message;
    return;
  }

  if (!isLegacy) {
    // Canvas sizing is now handled in the success callback
  }
})();
`;

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
    viewport: { width: 1920, height: 1080 },
    reducedMotion: 'no-preference',
    recordVideo: { dir: tempDir },
  });
  const page = await context.newPage();
  page.setDefaultTimeout(120000);

  page.on('console', msg => console.error(`[browser console] ${msg.type()}: ${msg.text()}`));
  page.on('pageerror', err => console.error(`[browser pageerror] ${err.message}`));

  await page.setContent(captureHtml, { timeout: 60000 });

  // Intercept ALL texture/image requests and serve via API endpoint (CORS enabled)
  await page.route('**/textures/**', async route => {
    const url = route.request().url();
    const texturePath = url.replace(`${args.origin}/textures/`, '');
    const apiUrl = `${args.origin}/api/github-asset?path=${texturePath}`;
    await route.fulfill({ url: apiUrl });
  });

  // Also intercept API calls to /api/s300019.png and similar - rewrite to proper API endpoint
  await page.route('**/api/s*.png', async route => {
    const url = route.request().url();
    const match = url.match(/\/api\/(s[0-9a-zA-Z_-]+)\.png/);
    if (match) {
      const texturePath = match[1] + '.png';
      // We must fetch the actual path from the library, not the root
      const fullPath = setSegments.join('/') + '/' + texturePath;
      const apiUrl = `${args.origin}/api/github-asset?path=${fullPath}`;
      console.error(`Intercepting s*.png: ${url} -> ${apiUrl}`);
      try {
        const response = await fetch(apiUrl);
        if (response.ok) {
          const buffer = await response.arrayBuffer();
          await route.fulfill({
            status: 200,
            contentType: 'image/png',
            body: Buffer.from(buffer)
          });
          return;
        }
      } catch (e) {
        console.error(`Failed to fetch texture: ${e.message}`);
      }
      await route.continue();
      return;
    }
  });

  // Intercept atlas loading and fix texture paths in atlas
  await page.route('**/*.atlas', async route => {
    const url = route.request().url();
    if (url.includes('/api/github-asset?path=') && url.includes('.atlas')) {
      // Already going through API, let it through
      return;
    }
    if (url.endsWith('.atlas') || url.includes('.atlas?')) {
      // Redirect atlas requests through API
      const pathMatch = url.match(/([^\/]+\.atlas)/);
      if (pathMatch) {
        const apiUrl = `${args.origin}/api/github-asset?path=library/${pathMatch[1]}`;
        console.error(`Intercepting atlas: ${url} -> ${apiUrl}`);
        try {
          const response = await fetch(apiUrl);
          if (response.ok) {
            const buffer = await response.arrayBuffer();
            let cType = 'application/octet-stream';
            if (apiUrl.endsWith('.png')) cType = 'image/png';
            else if (apiUrl.endsWith('.json')) cType = 'application/json';
            else if (apiUrl.endsWith('.atlas') || apiUrl.endsWith('.txt')) cType = 'text/plain';
            
            await route.fulfill({
              status: 200,
              contentType: cType,
              body: Buffer.from(buffer)
            });
            return;
          }
        } catch (e) {}
        await route.continue();
        return;
      }
    }
  });

  const playerScriptResponse = await fetch(playerJsUrl);
  if (!playerScriptResponse.ok) {
    console.error(`Failed to fetch spine-player script: ${playerScriptResponse.status} ${playerScriptResponse.statusText}`);
    process.exit(1);
  }
  const playerScriptContent = await playerScriptResponse.text();
  await page.addScriptTag({ content: playerScriptContent });

  await page.evaluate(initScript);

  // Wait for player to be created and resources to start loading
  await page.waitForFunction(() => window.__ready === true || window.__captureError !== null, { timeout: 60000, polling: 200 });

  const captureError = await page.evaluate(() => window.__captureError || null);
  if (captureError) {
    console.error(`SpinePlayer failed to initialize: ${captureError}`);
    process.exit(1);
  }

  // Wait for actual animation to be ready (track exists or fallback after player loads)
  await page.waitForFunction(() => {
    if (!window.__ready) return false;
    try {
      const player = window.__spinePlayer;
      if (!player) return false;
      
      const track = player.animationState ? player.animationState.getCurrent(0) : null;
      if (track && track.animation) {
        if (typeof track.animation.duration === 'number' && track.animation.duration > 0) {
          window.__animDuration = track.animation.duration;
          return true;
        }
      }
      
      // Also try to find it in the skeleton data directly if track isn't playing yet
      if (player.skeleton && player.skeleton.data && player.skeleton.data.animations) {
        const targetAnimName = player.config ? player.config.animation : null;
        if (targetAnimName) {
          const anim = player.skeleton.data.animations.find(a => a.name === targetAnimName);
          if (anim) {
             const dur = anim.duration !== undefined ? anim.duration : (anim.frames ? anim.frames[anim.frames.length - 1] : 0);
             if (dur > 0) {
               window.__animDuration = dur;
               return true;
             }
          }
        }
      }
      
      // As a last resort, if player is loaded, get the first animation's duration
      if (player.loaded && player.skeleton && player.skeleton.data && player.skeleton.data.animations.length > 0) {
        const anim = player.skeleton.data.animations[0];
        const dur = anim.duration !== undefined ? anim.duration : 2.0; // fallback 2s
        window.__animDuration = dur > 0 ? dur : 2.0;
        return true;
      }
      
      return false; // keep polling until duration is found or timeout occurs
    } catch (e) {
      return false;
    }
  }, { timeout: 30000, polling: 500 }).catch(() => {
    console.error('Timed out waiting for specific track animation, proceeding with fallback duration');
  });

  const error = await page.evaluate(() => window.__captureError || null);
  if (error) {
    console.error(`Capture failed: ${error}`);
    process.exit(1);
  }

  const browserAnimDuration = await page.evaluate(() => window.__animDuration || 0);
  const canvasWidth = await page.evaluate(() => window.__canvasWidth || 1920);
  const canvasHeight = await page.evaluate(() => window.__canvasHeight || 1080);

  // Use server-side computed duration (from skeleton JSON) as priority; fallback to browser-detected
  const animDuration = args.animDuration > 0 ? args.animDuration : (browserAnimDuration > 0 ? browserAnimDuration : 3);

  console.error(`Animation ready, duration=${animDuration}s (browser=${browserAnimDuration}s, server=${args.animDuration}s), canvas=${canvasWidth}x${canvasHeight}`);

  // Chunk mode: if chunkIndex >= 0, wait to the end of this chunk window
  // Total recording = chunkStart + chunkDuration (Playwright records from context open)
  // We want exactly 1 cycle = animDuration seconds
  let captureDuration;
  if (args.chunkIndex >= 0) {
    const chunkStart = args.chunkIndex * args.chunkDuration;
    captureDuration = chunkStart + Math.min(args.chunkDuration, animDuration - chunkStart);
    console.error(`Chunk mode: index=${args.chunkIndex}, start=${chunkStart}s, window=${captureDuration}s`);
  } else {
    // Normal mode: exactly 1 cycle (animDuration seconds), no extra second
    captureDuration = animDuration;
  }

  // Minimum 1s to avoid empty recordings
  if (captureDuration < 1) captureDuration = 1;

  await new Promise(resolve => setTimeout(resolve, captureDuration * 1000));

  await context.close();

  const videoFiles = fs.readdirSync(tempDir).filter(f => f.endsWith('.webm'));
  if (videoFiles.length === 0) {
    console.error('No video file produced by Playwright');
    process.exit(1);
  }

  const videoPath = path.join(tempDir, videoFiles[0]);
  const videoSize = fs.statSync(videoPath).size;
  console.error(`Playwright recording: ${videoPath} (${videoSize} bytes)`);

  if (videoSize < 100) {
    console.error('Recorded video is too small, possibly empty');
    process.exit(1);
  }

  const outputPath = args.output || `${args.uploadId}-${targetAnimation}-preview.webm`;
  fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });
  fs.copyFileSync(videoPath, outputPath);

  const webmBuffer = fs.readFileSync(outputPath);
  const meta = {
    animation: targetAnimation,
    animationDuration: animDuration,
    capturedDuration: captureDuration,
    chunkIndex: args.chunkIndex,
    width: canvasWidth,
    height: canvasHeight,
    bytes: webmBuffer.length,
    sha256: createHash('sha256').update(webmBuffer).digest('hex'),
    isDefault,
  };
  fs.writeFileSync(outputPath + '.json', JSON.stringify(meta, null, 2));

  console.error(`WebM saved: ${outputPath} (${webmBuffer.length} bytes, ${canvasWidth}x${canvasHeight})`);

  console.log(JSON.stringify({ ...meta, ok: true, path: outputPath }));

  try { fs.rmSync(tempDir, { recursive: true }); } catch { }

} finally {
  await browser.close();
  try { fs.rmSync(tempDir, { recursive: true }); } catch { }
}