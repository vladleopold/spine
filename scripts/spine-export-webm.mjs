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

function mimeFor(filename) {
  const ext = path.extname(filename).toLowerCase();
  if (ext === '.png') return 'image/png';
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.webp') return 'image/webp';
  if (ext === '.json') return 'application/json';
  if (ext === '.skel') return 'application/octet-stream';
  if (ext === '.atlas') return 'text/plain';
  return 'application/octet-stream';
}

const isDefault = args.animation && args.defaultAnimation && args.animation === args.defaultAnimation;

console.error(`Entry: ${args.uploadId}`);
console.error(`Set: ${firstSet.name}`);
console.error(`Skeleton: ${skeletonFile} (v${skeletonVersion})`);
console.error(`Atlas: ${atlasFile}`);
console.error(`Animation: ${targetAnimation}`);
console.error(`Is default: ${isDefault}`);
console.error(`Files: ${[skeletonFile, atlasFile, ...textureFiles].join(', ')}`);


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
    transitionTime: 0,
    premultipliedAlpha: false,
    preserveDrawingBuffer: true,
    alpha: true,
    backgroundColor: '#000000',
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
  });
  const page = await context.newPage();
  page.setDefaultTimeout(120000);

  page.on('console', msg => console.error(`[browser console] ${msg.type()}: ${msg.text()}`));
  page.on('pageerror', err => console.error(`[browser pageerror] ${err.message}`));

  await page.setContent(captureHtml, { timeout: 60000 });

  // Intercept ALL requests from SpinePlayer and serve files directly from disk (fast, no base64, no HTTP)
  const spineFiles = new Map();
  for (const f of [skeletonFile, atlasFile, ...textureFiles]) {
    spineFiles.set(f.toLowerCase(), path.join(firstSet.path, f));
    spineFiles.set(path.basename(f).toLowerCase(), path.join(firstSet.path, f));
  }

  await page.route('**', async route => {
    const url = route.request().url();
    const urlBasename = url.split('/').pop().split('?')[0].toLowerCase();
    if (spineFiles.has(urlBasename)) {
      const diskPath = spineFiles.get(urlBasename);
      console.error(`Serving from disk: ${urlBasename} -> ${diskPath}`);
      const body = fs.readFileSync(diskPath);
      await route.fulfill({ status: 200, contentType: mimeFor(urlBasename), body });
      return;
    }
    await route.continue();
  });

  const playerScriptResponse = await fetch(playerJsUrl);
  if (!playerScriptResponse.ok) {
    console.error(`Failed to fetch spine-player script: ${playerScriptResponse.status} ${playerScriptResponse.statusText}`);
    process.exit(1);
  }
  const playerScriptContent = await playerScriptResponse.text();

  // Inject Virtual Time polyfill to guarantee exact 30fps without speedups
  await page.addInitScript(`
    window.__virtualTime = 1000;
    const origDateNow = Date.now;
    const origPerfNow = performance.now.bind(performance);
    
    Date.now = () => Math.floor(window.__virtualTime);
    performance.now = () => window.__virtualTime;
    
    const rafCallbacks = new Set();
    window.requestAnimationFrame = (cb) => {
      const id = origPerfNow();
      rafCallbacks.add({ id, cb });
      return id;
    };
    window.cancelAnimationFrame = (id) => {
      for (const item of rafCallbacks) {
        if (item.id === id) {
          rafCallbacks.delete(item);
          break;
        }
      }
    };
    
    window.__stepFrame = (deltaMs) => {
      window.__virtualTime += deltaMs;
      const callbacks = Array.from(rafCallbacks);
      rafCallbacks.clear();
      for (const item of callbacks) {
        try { item.cb(window.__virtualTime); } catch(e) {}
      }
    };
  `);

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

  // Normal mode: exactly 1 cycle
  const captureDuration = animDuration > 0 ? animDuration : 3;

  console.error(`Starting frame capture: ${captureDuration}s at 30fps`);

  const FPS = 30;
  const totalFrames = Math.ceil(captureDuration * FPS);
  const frameInterval = 1000 / FPS;
  const framesDir = path.join(tempDir, 'frames');
  fs.mkdirSync(framesDir, { recursive: true });

  for (let i = 0; i < totalFrames; i++) {
    const framePath = path.join(framesDir, `frame_${String(i).padStart(5, '0')}.png`);
    await page.screenshot({ path: framePath, type: 'png' });
    
    // Advance virtual time by exact frame interval instead of real-time waiting
    if (i < totalFrames - 1) {
      await page.evaluate((ms) => {
        if (window.__stepFrame) window.__stepFrame(ms);
      }, frameInterval);
      // Give browser a moment to process RAF callbacks
      await page.evaluate(() => new Promise(resolve => setTimeout(resolve, 0)));
    }
  }

  console.error(`Captured ${totalFrames} frames, encoding with ffmpeg...`);

  const { execFileSync } = await import('child_process');
  const outputPath = args.output || `${args.uploadId}-${targetAnimation}-preview.webm`;
  fs.mkdirSync(path.dirname(path.resolve(outputPath)), { recursive: true });

  execFileSync('ffmpeg', [
    '-y',
    '-framerate', String(FPS),
    '-i', path.join(framesDir, 'frame_%05d.png'),
    '-c:v', 'libvpx-vp9',
    '-b:v', '2M',
    '-pix_fmt', 'yuva420p',
    outputPath
  ], { stdio: ['ignore', 'pipe', 'pipe'] });

  await context.close();

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