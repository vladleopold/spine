#!/usr/bin/env node
// Hourly byte-level proof for every public archive card with an exact indexed
// animation. It never substitutes tracks, writes indexes, or logs private IDs.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { readIndex, listCollectionFolders } from './resolve-library.mjs';
import {
  includeRootArchiveIndex,
  classifyArchiveEntryStatus,
  listVisibleArchiveEntries,
  resolveExactArchiveMedia,
  validateArchiveMediaUrl,
  classifyArchiveMediaHttpStatus,
  selectArchiveMediaPreflight,
  shouldRunArchiveMediaAudit,
  hasWebmSignature,
  hasWebpSignature,
} from './lib/archive-live-media-audit.mjs';

const root = process.cwd();
const origin = 'https://spine-link.vercel.app';
const archiveUrl = origin + '/world-spine-archive';
const folders = listCollectionFolders(root);
const rootIndex = readIndex(root, '.') || [];
const collections = includeRootArchiveIndex(
  folders.map((folder) => ({ folder, entries: readIndex(root, folder) || [] })),
  rootIndex,
);
const visible = listVisibleArchiveEntries(collections);
if (!visible.length) throw new Error('ARCHIVE_INDEX_EMPTY');

let blockedEntries = 0;
let failedEntries = 0;
let notReadyEntries = 0;
let staleReadyEntries = 0;
let missingExactPairEntries = 0;
let invalidPairEntries = 0;
const candidates = [];

for (let slot = 0; slot < visible.length; slot += 1) {
  const { folder, entry } = visible[slot];
  const status = classifyArchiveEntryStatus(entry);
  if (status === 'failed') failedEntries += 1;
  else if (status === 'blocked') blockedEntries += 1;
  else if (status === 'not-ready') notReadyEntries += 1;

  const selected = resolveExactArchiveMedia(entry);
  if (!selected.ok) {
    missingExactPairEntries += 1;
    if (status === 'ready') staleReadyEntries += 1;
    continue;
  }

  const previewPath = String(entry.previewPath || (folder + '/' + entry.id))
    .replace(/\\/g, '/').replace(/\/+$/, '');
  const validPairs = selected.pairs.every((pair) =>
    validateArchiveMediaUrl(pair.webm, origin, previewPath, pair.webmName) &&
    validateArchiveMediaUrl(pair.poster, origin, previewPath, pair.posterName));
  if (!validPairs) {
    invalidPairEntries += 1;
    continue;
  }
  candidates.push({ slot, folder, previewPath, pairs: selected.pairs, status });
}

const tasks = candidates.flatMap((candidate) => candidate.pairs.map((pair) => ({
  slot: candidate.slot,
  folder: candidate.folder,
  previewPath: candidate.previewPath,
  ...pair,
})));

const summary = {
  collections: collections.length,
  rootIndexEntries: rootIndex.length,
  visibleEntries: visible.length,
  declaredReadyEntries: visible.filter(({ entry }) => entry.webmStatus === 'ready').length,
  readyEntries: candidates.filter((item) => item.status === 'ready').length,
  exactMediaEntries: candidates.length,
  blockedExactMediaEntries: candidates.filter((item) => item.status === 'blocked').length,
  failedExactMediaEntries: candidates.filter((item) => item.status === 'failed').length,
  notReadyExactMediaEntries: candidates.filter((item) => item.status === 'not-ready').length,
  blockedEntries,
  staleReadyEntries,
  missingExactPairEntries,
  invalidPairEntries,
  failedEntries,
  notReadyEntries,
  mediaPairs: tasks.length,
  verifiedPairs: 0,
  blockedPairs: 0,
  failedPairs: 0,
  unattemptedPairs: 0,
  preflightPairs: 0,
  preflightVerifiedPairs: 0,
  preflightBlockedPairs: 0,
  preflightFailedPairs: 0,
  sourceMutations: 0,
};

let originStatus = 0;
let originBlockedReason = '';
try {
  const response = await fetch(archiveUrl, {
    cache: 'no-store',
    signal: AbortSignal.timeout(15000),
  });
  originStatus = response.status;
  if (!response.ok) originBlockedReason = 'PRODUCTION_ORIGIN_HTTP_' + response.status;
} catch (error) {
  originBlockedReason = error?.name === 'TimeoutError'
    ? 'PRODUCTION_ORIGIN_TIMEOUT'
    : 'PRODUCTION_ORIGIN_UNAVAILABLE';
}

const tempDir = tasks.length
  ? fs.mkdtempSync(path.join(os.tmpdir(), 'spine-archive-live-'))
  : null;
let assetBlockedReason = '';

async function fetchAsset(url, type) {
  try {
    const response = await fetch(url, {
      cache: 'no-store',
      signal: AbortSignal.timeout(20000),
    });
    if (!response.ok) {
      return {
        ok: false,
        classification: classifyArchiveMediaHttpStatus(response.status),
        code: 'HTTP_' + response.status,
      };
    }
    const contentType = (response.headers.get('content-type') || '').toLowerCase();
    const bytes = Buffer.from(await response.arrayBuffer());
    const signature = type === 'webm' ? hasWebmSignature(bytes) : hasWebpSignature(bytes);
    const expectedType = type === 'webm' ? 'video/webm' : 'image/webp';
    if (!signature || !contentType.includes(expectedType)) {
      return { ok: false, classification: 'failed', code: 'INVALID_MEDIA_BODY_OR_TYPE' };
    }
    return { ok: true, bytes };
  } catch (error) {
    return {
      ok: false,
      classification: 'blocked',
      code: error?.name === 'TimeoutError' ? 'MEDIA_TIMEOUT' : 'MEDIA_NETWORK_UNAVAILABLE',
    };
  }
}

async function verifyPair(task) {
  const [video, poster] = await Promise.all([
    fetchAsset(task.webm, 'webm'),
    fetchAsset(task.poster, 'webp'),
  ]);
  const blocked = [video, poster].find((item) => !item.ok && item.classification === 'blocked');
  if (blocked) return blocked;
  const failed = [video, poster].find((item) => !item.ok);
  if (failed) return failed;

  const prefix = String(task.slot) + '-' + task.tier;
  const videoFile = path.join(tempDir, prefix + '.webm');
  const posterFile = path.join(tempDir, prefix + '.webp');
  fs.writeFileSync(videoFile, video.bytes);
  fs.writeFileSync(posterFile, poster.bytes);
  try {
    const probe = JSON.parse(execFileSync('ffprobe', [
      '-v', 'error', '-count_frames', '-select_streams', 'v:0',
      '-show_entries', 'stream=nb_read_frames,width,height:format=duration',
      '-of', 'json', videoFile,
    ], { encoding: 'utf8', timeout: 60000, stdio: ['ignore', 'pipe', 'ignore'] }));
    const stream = probe.streams?.[0] || {};
    const frames = Number(stream.nb_read_frames) || 0;
    const duration = Number(probe.format?.duration) || 0;
    if (!(frames >= 8 && duration >= 0.5 && Number(stream.width) > 0 && Number(stream.height) > 0)) {
      return { ok: false, classification: 'failed', code: 'WEBM_FRAME_OR_DIMENSION_REJECTED' };
    }
    execFileSync(process.execPath, [
      path.join(root, 'scripts/verify-preview-motion.mjs'),
      videoFile,
    ], { stdio: 'ignore', timeout: 150000 });
    execFileSync(process.execPath, [
      path.join(root, 'scripts/verify-poster-first-frame.mjs'),
      videoFile,
      posterFile,
    ], { stdio: 'ignore', timeout: 150000 });
    return {
      ok: true,
      webmBytes: video.bytes.length,
      webpBytes: poster.bytes.length,
    };
  } catch {
    return { ok: false, classification: 'failed', code: 'MEDIA_DECODE_OR_MOTION_FAILED' };
  }
}

function recordResult(result, task) {
  if (result.ok) summary.verifiedPairs += 1;
  else if (result.classification === 'blocked') {
    summary.blockedPairs += 1;
    if (!assetBlockedReason) assetBlockedReason = result.code || 'PRODUCTION_MEDIA_BLOCKED';
  } else summary.failedPairs += 1;

  if (task) {
    console.log('ARCHIVE_MEDIA_PAIR=' + JSON.stringify({
      slot: task.slot,
      tier: task.tier,
      declaredStatus: task.status || 'unknown',
      ok: Boolean(result.ok),
      code: result.code || '',
      webmBytes: result.webmBytes || 0,
      webpBytes: result.webpBytes || 0,
    }));
  }
}

try {
  // A blocked archive HTML route does not prove that the static media origin is
  // also blocked. Probe one exact high-quality pair per collection first.
  // If every preflight pair is blocked, stop before issuing hundreds of futile
  // requests; otherwise continue the complete byte/decode audit.
  const preflightTasks = originBlockedReason
    ? selectArchiveMediaPreflight(candidates, 4)
    : [];
  summary.preflightPairs = preflightTasks.length;
  const preflightResults = preflightTasks.length
    ? await Promise.all(preflightTasks.map((task) => verifyPair(task)))
    : [];
  for (let i = 0; i < preflightResults.length; i += 1) {
    const task = preflightTasks[i];
    const result = preflightResults[i];
    if (result.ok) summary.preflightVerifiedPairs += 1;
    else if (result.classification === 'blocked') summary.preflightBlockedPairs += 1;
    else summary.preflightFailedPairs += 1;
    recordResult(result, task);
  }

  const runFullMediaAudit = shouldRunArchiveMediaAudit(
    originStatus,
    preflightResults,
    tasks.length,
  );

  if (runFullMediaAudit) {
    const preflightKeys = new Set(preflightTasks.map((task) => String(task.slot) + ':' + task.tier));
    const remainingTasks = tasks.filter((task) =>
      !preflightKeys.has(String(task.slot) + ':' + task.tier));
    let cursor = 0;

    async function worker() {
      while (cursor < remainingTasks.length) {
        const task = remainingTasks[cursor];
        cursor += 1;
        const result = await verifyPair(task);
        recordResult(result, task);
      }
    }

    await Promise.all(Array.from(
      { length: Math.min(4, remainingTasks.length) },
      () => worker(),
    ));
  } else {
    summary.unattemptedPairs = Math.max(0, tasks.length - preflightResults.length);
  }
} finally {
  if (tempDir) fs.rmSync(tempDir, { recursive: true, force: true });
}

summary.originStatus = originStatus;
summary.originBlockedReason = originBlockedReason;
summary.assetBlockedReason = assetBlockedReason;
if (summary.unattemptedPairs === 0) {
  summary.unattemptedPairs = Math.max(0, tasks.length -
    summary.verifiedPairs - summary.blockedPairs - summary.failedPairs);
}
console.log('ARCHIVE_PRODUCTION_MEDIA_AUDIT=' + JSON.stringify(summary));

const originClass = classifyArchiveMediaHttpStatus(originStatus);
if (originClass === 'failed' || summary.failedEntries > 0 ||
    summary.failedPairs > 0 || summary.staleReadyEntries > 0 || summary.invalidPairEntries > 0) {
  process.exitCode = 1;
} else if (originBlockedReason || assetBlockedReason || summary.blockedEntries > 0 ||
    summary.notReadyEntries > 0 || summary.missingExactPairEntries > 0 ||
    (summary.readyEntries === 0 && summary.visibleEntries > 0)) {
  process.exitCode = 2;
}
