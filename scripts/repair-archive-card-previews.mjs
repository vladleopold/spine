#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { listCollectionFolders, readIndex } from './resolve-library.mjs';
import { previewSourceFingerprint, repairRecordTimestamp, validateFrozenRepairRecord } from './repair-manifest-guard.mjs';
import { generateFirstFrameWebp } from './lib/first-frame-poster.mjs';

const ROOT = process.cwd();
const ORIGIN = 'https://spine-link.vercel.app';

function safeRelative(value) {
  const normalized = String(value || '').replace(/\\/g, '/');
  if (!normalized || normalized.startsWith('/') || normalized.split('/').includes('..')) return '';
  return normalized;
}

function safeAnimationName(value) {
  return String(value || '').replace(/[^a-zA-Z0-9_-]/g, '_');
}

export function animationAssetPath(value, entry, previewPath, animation, tier) {
  try {
    const url = new URL(String(value || ''));
    if (url.protocol !== 'https:' || url.hostname !== 'spine-link.vercel.app') return '';
    const pathname = decodeURIComponent(url.pathname);
    const marker = '/assets/';
    const markerAt = pathname.indexOf(marker);
    if (markerAt < 0) return '';
    const assetPath = pathname.slice(markerAt + marker.length);
    const idMarker = '/' + entry.id + '/';
    const idAt = assetPath.indexOf(idMarker);
    if (idAt < 0) return '';
    const suffix = safeRelative(assetPath.slice(idAt + idMarker.length));
    const safeName = safeAnimationName(animation);
    if (!suffix.startsWith('animations/' + safeName + '/')) return '';
    if (!suffix.endsWith('-preview-' + tier + '.webm') && !suffix.endsWith('/preview-' + tier + '.webm')) return '';
    return safeRelative(path.posix.join(previewPath, suffix));
  } catch {
    return '';
  }
}

function sourceSelection(record, basePath) {
  const animation = String(record.defaultAnimation || '').trim();
  if (!animation) return null;
  const previewPath = safeRelative(record.previewPath || (basePath + '/' + record.id));
  if (!previewPath || !previewPath.startsWith(basePath + '/') ||
      previewPath.split('/').includes('..')) return null;
  const selected = record.allAnimationPreviews &&
    typeof record.allAnimationPreviews === 'object'
    ? record.allAnimationPreviews[animation] || null
    : null;
  const animationMedium = animationAssetPath(selected && selected.webmPreviewMedium, record, previewPath, animation, 'medium');
  const animationLow = animationAssetPath(selected && selected.webmPreviewLow, record, previewPath, animation, 'low');
  const hasAnimationPair = Boolean(animationMedium && animationLow);
  const rootMedium = previewPath + '/preview-medium.webm';
  const rootLow = previewPath + '/preview-low.webm';
  const sourceMedium = hasAnimationPair ? animationMedium : rootMedium;
  const sourceLow = hasAnimationPair ? animationLow : rootLow;
  if (!hasAnimationPair && !(record.webmPreviewMedium && record.webmPreviewLow)) return null;
  return {
    id: record.id,
    basePath,
    previewPath,
    animation,
    uploadedAt: repairRecordTimestamp(record),
    sourceFingerprint: previewSourceFingerprint(record),
    sourceKind: hasAnimationPair ? 'animation' : 'root',
    sourceMediumSuffix: sourceMedium.slice(previewPath.length + 1),
    sourceLowSuffix: sourceLow.slice(previewPath.length + 1),
    rootMediaFingerprint: hashValue([record.webmPreviewMedium || '', record.webmPreviewLow || '']),
    animationMediaFingerprint: hashValue([
      selected && selected.webmPreviewMedium || '',
      selected && selected.webmPreviewLow || '',
    ]),
  };
}

function makeBatches(items, size = 12) {
  const batches = [];
  for (let i = 0; i < items.length; i += size) {
    const entries = items.slice(i, i + size);
    const paths = new Set([
      '/scripts/repair-archive-card-previews.mjs',
      '/scripts/resolve-library.mjs',
      '/scripts/repair-manifest-guard.mjs',
      '/scripts/lib/first-frame-poster.mjs',
      '/library/index.json',
      '/library_*/index.json',
    ]);
    for (const entry of entries) {
      for (const file of [
        path.posix.join(entry.previewPath, entry.sourceMediumSuffix),
        path.posix.join(entry.previewPath, entry.sourceLowSuffix),
        entry.previewPath + '/preview-medium.webm',
        entry.previewPath + '/preview-low.webm',
      ]) paths.add('/' + file);
    }
    batches.push({ entries, sparseCheckout: [...paths].join('\n') });
  }
  return batches;
}

function sha256(file) {
  return createHash('sha256').update(fs.readFileSync(file)).digest('hex');
}

function hashValue(value) {
  return createHash('sha256').update(JSON.stringify(value)).digest('hex');
}

function probeVideo(file) {
  const parsed = JSON.parse(execFileSync('ffprobe', [
    '-v', 'error', '-count_frames', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,nb_read_frames:format=duration',
    '-of', 'json', file,
  ], { encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'ignore'] }));
  const stream = parsed.streams && parsed.streams[0] || {};
  const width = Number(stream.width || 0);
  const height = Number(stream.height || 0);
  const frames = Number(stream.nb_read_frames || 0);
  const duration = Number(parsed.format && parsed.format.duration || 0);
  if (!(width > 0 && height > 0 && frames >= 5 && duration >= 0.15 && frames / duration >= 2)) {
    throw new Error('source video failed minimum motion/frame acceptance');
  }
  return { width, height, frames, duration };
}

function resolveInside(root, relative) {
  const safe = safeRelative(relative);
  if (!safe) throw new Error('unsafe media path');
  const resolved = path.resolve(root, safe);
  if (!resolved.startsWith(path.resolve(root) + path.sep)) throw new Error('media path escaped repository');
  return resolved;
}

export function isPublicPreviewRepairCandidate(record) {
  return Boolean(record &&
    record.testOnly !== true &&
    record.hiddenFromPublicLibrary !== true &&
    record.webmStatus === 'ready' &&
    record.previewStatus !== 'ready');
}

function matrix() {
  const folders = listCollectionFolders(ROOT);
  const items = [];
  for (const folder of folders) {
    for (const record of readIndex(ROOT, folder) || []) {
      if (isPublicPreviewRepairCandidate(record)) {
        const item = sourceSelection(record, folder);
        if (!item || !Number.isFinite(item.uploadedAt) || !/^[a-f0-9]{64}$/.test(item.sourceFingerprint)) continue;
        items.push(item);
      }
    }
  }
  const batches = makeBatches(items);
  console.log('matrix=' + JSON.stringify(batches));
  console.log('candidateCount=' + items.length);
  console.error('ARCHIVE_PREVIEW_CANDIDATES=' + items.length + ' BATCHES=' + batches.length);
}

function render() {
  const entries = JSON.parse(process.env.REPAIR_BATCH_JSON || '[]');
  if (!Array.isArray(entries) || entries.length === 0) throw new Error('empty render batch');
  fs.rmSync('out', { recursive: true, force: true });
  const summary = { rendered: 0, skipped: 0, entries: [] };
  for (const item of entries) {
    const dir = path.join('out', item.id);
    fs.mkdirSync(dir, { recursive: true });
    try {
      const rootMedium = resolveInside(ROOT, item.previewPath + '/preview-medium.webm');
      const rootLow = resolveInside(ROOT, item.previewPath + '/preview-low.webm');
      let sourceMedium = resolveInside(ROOT, path.posix.join(item.previewPath, item.sourceMediumSuffix));
      let sourceLow = resolveInside(ROOT, path.posix.join(item.previewPath, item.sourceLowSuffix));
      let actualSourceKind = item.sourceKind;
      let actualSourceFingerprint = item.sourceKind === 'animation'
        ? item.animationMediaFingerprint
        : item.rootMediaFingerprint;
      if ((!fs.existsSync(sourceMedium) || !fs.existsSync(sourceLow)) &&
          item.sourceKind === 'animation' && fs.existsSync(rootMedium) && fs.existsSync(rootLow)) {
        sourceMedium = rootMedium;
        sourceLow = rootLow;
        actualSourceKind = 'root';
        actualSourceFingerprint = item.rootMediaFingerprint;
      }
      if (!fs.existsSync(sourceMedium) || !fs.existsSync(sourceLow)) {
        throw new Error('selected animation and root WebM pairs are missing');
      }
      const mediumInfo = probeVideo(sourceMedium);
      const lowInfo = probeVideo(sourceLow);
      const mediumHash = sha256(sourceMedium);
      const lowHash = sha256(sourceLow);
      const replaceMediumVideo = !fs.existsSync(rootMedium) || sha256(rootMedium) !== mediumHash;
      const replaceLowVideo = !fs.existsSync(rootLow) || sha256(rootLow) !== lowHash;
      if (replaceMediumVideo) fs.copyFileSync(sourceMedium, path.join(dir, 'preview-medium.webm'));
      if (replaceLowVideo) fs.copyFileSync(sourceLow, path.join(dir, 'preview-low.webm'));
      const mediumPoster = path.join(dir, 'preview-medium.webp');
      const lowPoster = path.join(dir, 'preview-low.webp');
      const mediumPosterInfo = generateFirstFrameWebp(sourceMedium, mediumPoster);
      const lowPosterInfo = generateFirstFrameWebp(sourceLow, lowPoster);
      const meta = {
        id: item.id, ok: true, animation: item.animation,
        manifest: item,
        sourceKind: actualSourceKind,
        actualSourceFingerprint,
        replaceMediumVideo, replaceLowVideo,
        mediumVideoSha256: mediumHash, lowVideoSha256: lowHash,
        mediumPosterSha256: sha256(mediumPoster), lowPosterSha256: sha256(lowPoster),
        width: mediumInfo.width, height: mediumInfo.height,
        mediumFrames: mediumInfo.frames, lowFrames: lowInfo.frames,
        mediumDuration: mediumInfo.duration, lowDuration: lowInfo.duration,
        mediumPosterBytes: mediumPosterInfo.bytes, lowPosterBytes: lowPosterInfo.bytes,
      };
      fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify(meta, null, 2));
      summary.rendered++;
      summary.entries.push({ id: item.id, ok: true, animation: item.animation });
    } catch (error) {
      fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({
        id: item.id, ok: false, reason: String(error && error.message || error).slice(0, 240),
      }, null, 2));
      summary.skipped++;
      summary.entries.push({ id: item.id, ok: false });
    }
  }
  console.log('ARCHIVE_PREVIEW_RENDERED=' + summary.rendered + ' SKIPPED=' + summary.skipped);
}

function merge() {
  const artifactRoot = path.join(ROOT, 'downloaded-previews');
  const folders = listCollectionFolders(ROOT);
  const indexes = new Map();
  const summary = { restored: [], skipped: [] };
  const now = new Date().toISOString();
  const artifactDirs = fs.existsSync(artifactRoot)
    ? fs.readdirSync(artifactRoot, { withFileTypes: true }).filter(entry => entry.isDirectory())
    : [];
  for (const artifactDir of artifactDirs) {
    const artifact = path.join(artifactRoot, artifactDir.name);
    let meta = null;
    try { meta = JSON.parse(fs.readFileSync(path.join(artifact, 'meta.json'), 'utf8')); } catch {}
    if (!meta || !meta.ok || !meta.manifest || meta.id !== artifactDir.name) {
      summary.skipped.push({ id: artifactDir.name, reason: 'render-artifact-unavailable' });
      continue;
    }
    const item = meta.manifest;
    let info;
    try {
      info = validateFrozenRepairRecord(ROOT, item, folders, readIndex);
    } catch (error) {
      // Hidden and test-only records may become ineligible after inventory.
      // Do not leak their identifiers into the public summary artifact.
      const reason = /not public/i.test(String(error && error.message || error))
        ? 'not-public'
        : 'source-guard-rejected';
      summary.skipped.push({ reason });
      continue;
    }
    const indexPath = path.join(ROOT, info.basePath, 'index.json');
    if (!indexes.has(indexPath)) indexes.set(indexPath, readIndex(ROOT, info.basePath) || []);
    const records = indexes.get(indexPath);
    const record = records.find(entry => entry && entry.id === item.id);
    if (!record || record.webmStatus !== 'ready' || record.defaultAnimation !== item.animation) {
      summary.skipped.push({ id: item.id, reason: 'source-selection-changed' });
      continue;
    }
    if (meta.animation !== item.animation) {
      summary.skipped.push({ id: item.id, reason: 'render-animation-mismatch' });
      continue;
    }
    const currentSelected = record.allAnimationPreviews &&
      typeof record.allAnimationPreviews === 'object'
      ? record.allAnimationPreviews[item.animation] || null
      : null;
    const currentRootFingerprint = hashValue([
      record.webmPreviewMedium || '', record.webmPreviewLow || '',
    ]);
    const currentAnimationFingerprint = hashValue([
      currentSelected && currentSelected.webmPreviewMedium || '',
      currentSelected && currentSelected.webmPreviewLow || '',
    ]);
    const currentSourceFingerprint = meta.sourceKind === 'animation'
      ? currentAnimationFingerprint
      : currentRootFingerprint;
    if (currentSourceFingerprint !== meta.actualSourceFingerprint ||
        currentRootFingerprint !== item.rootMediaFingerprint) {
      summary.skipped.push({ id: item.id, reason: 'preview-source-url-changed' });
      continue;
    }
    const mediumPoster = path.join(artifact, 'preview-medium.webp');
    const lowPoster = path.join(artifact, 'preview-low.webp');
    if (!fs.existsSync(mediumPoster) || !fs.existsSync(lowPoster) ||
        sha256(mediumPoster) !== meta.mediumPosterSha256 ||
        sha256(lowPoster) !== meta.lowPosterSha256) {
      summary.skipped.push({ id: item.id, reason: 'poster-artifact-invalid' });
      continue;
    }
    const destination = resolveInside(ROOT, info.previewPath);
    fs.mkdirSync(destination, { recursive: true });
    if (meta.replaceMediumVideo) {
      const source = path.join(artifact, 'preview-medium.webm');
      if (!fs.existsSync(source) || sha256(source) !== meta.mediumVideoSha256) {
        summary.skipped.push({ id: item.id, reason: 'medium-video-artifact-invalid' });
        continue;
      }
      fs.copyFileSync(source, path.join(destination, 'preview-medium.webm'));
    }
    if (meta.replaceLowVideo) {
      const source = path.join(artifact, 'preview-low.webm');
      if (!fs.existsSync(source) || sha256(source) !== meta.lowVideoSha256) {
        summary.skipped.push({ id: item.id, reason: 'low-video-artifact-invalid' });
        continue;
      }
      fs.copyFileSync(source, path.join(destination, 'preview-low.webm'));
    }
    fs.copyFileSync(mediumPoster, path.join(destination, 'preview-medium.webp'));
    fs.copyFileSync(lowPoster, path.join(destination, 'preview-low.webp'));
    const baseUrl = ORIGIN + '/assets/' + info.previewPath.split('/').map(encodeURIComponent).join('/');
    const previews = record.allAnimationPreviews && typeof record.allAnimationPreviews === 'object'
      ? { ...record.allAnimationPreviews }
      : {};
    const selected = { ...(previews[item.animation] || {}) };
    selected.webmPreviewMedium = baseUrl + '/preview-medium.webm';
    selected.webmPreviewLow = baseUrl + '/preview-low.webm';
    selected.webpPosterMedium = baseUrl + '/preview-medium.webp';
    selected.webpPosterLow = baseUrl + '/preview-low.webp';
    previews[item.animation] = selected;
    record.allAnimationPreviews = previews;
    record.webmPreviewMedium = selected.webmPreviewMedium;
    record.webmPreviewLow = selected.webmPreviewLow;
    record.webpPosterMedium = selected.webpPosterMedium;
    record.webpPosterLow = selected.webpPosterLow;
    record.previewStatus = 'ready';
    record.previewError = '';
    record.previewStatusGeneratedAt = now;
    record.posterGeneratedAt = now;
    if (!(Number(record.previewWidth) > 0)) record.previewWidth = meta.width;
    if (!(Number(record.previewHeight) > 0)) record.previewHeight = meta.height;
    summary.restored.push({
      id: item.id, animation: item.animation,
      urls: [
        selected.webmPreviewMedium, selected.webpPosterMedium,
        selected.webmPreviewLow, selected.webpPosterLow,
      ],
    });
  }
  for (const [indexPath, records] of indexes) {
    fs.writeFileSync(indexPath, JSON.stringify(records, null, 2));
  }
  fs.writeFileSync('preview-repair-summary.json', JSON.stringify(summary, null, 2));
  console.log('ARCHIVE_PREVIEW_RESTORED=' + summary.restored.length + ' SKIPPED=' + summary.skipped.length);
}

async function verifyProduction() {
  const summary = JSON.parse(fs.readFileSync('preview-repair-summary.json', 'utf8'));
  const queue = summary.restored.flatMap(entry => entry.urls.map(url => ({ id: entry.id, url })));
  const failures = [];
  let cursor = 0;
  const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
  async function worker() {
    while (cursor < queue.length) {
      const item = queue[cursor++];
      let ok = false, last = '';
      for (let attempt = 0; attempt < 8; attempt++) {
        try {
          const response = await fetch(item.url, { method: 'HEAD', signal: AbortSignal.timeout(15000) });
          if (response.ok) { ok = true; break; }
          last = 'HTTP ' + response.status;
        } catch (error) {
          last = String(error && error.message || error).slice(0, 120);
        }
        await delay(4000);
      }
      if (!ok) failures.push({ id: item.id, url: item.url, error: last });
    }
  }
  await Promise.all(Array.from({ length: 12 }, () => worker()));
  console.log('PRODUCTION_MEDIA_CHECKED=' + queue.length + ' FAILED=' + failures.length);
  if (failures.length) {
    fs.writeFileSync('preview-production-failures.json', JSON.stringify(failures, null, 2));
    throw new Error('Production preview media verification failed for ' + failures.length + ' assets');
  }
}

async function main() {
  const action = process.argv[2] || 'matrix';
  if (action === 'matrix') return matrix();
  if (action === 'render') return render();
  if (action === 'merge') return merge();
  if (action === 'verify') return verifyProduction();
  throw new Error('Unknown action: ' + action);
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  await main();
}
