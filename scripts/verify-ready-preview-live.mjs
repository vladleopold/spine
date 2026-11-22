#!/usr/bin/env node
// Hourly byte-level proof for every public archive card with an exact indexed
// animation. It never substitutes tracks, writes indexes, or logs private IDs.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { readIndex, listCollectionFolders } from './resolve-library.mjs';
import {
  listVisibleArchiveEntries,
  resolveExactArchiveMedia,
  validateArchiveMediaUrl,
  classifyArchiveMediaHttpStatus,
  hasWebmSignature,
  hasWebpSignature,
} from './lib/archive-live-media-audit.mjs';

const root = process.cwd();
const origin = 'https://spine-link.vercel.app';
const archiveUrl = origin + '/world-spine-archive';
const folders = listCollectionFolders(root);
const collections = folders.map((folder) => ({
  folder,
  entries: readIndex(root, folder) || [],
}));
const visible = listVisibleArchiveEntries(collections);
if (!visible.length) throw new Error('ARCHIVE_INDEX_EMPTY');

let blockedEntries = 0;
let failedEntries = 0;
let notReadyEntries = 0;
let staleReadyEntries = 0;
const candidates = [];

for (let slot = 0; slot < visible.length; slot += 1) {
  const { folder, entry } = visible[slot];
  const webmStatus = typeof entry.webmStatus === 'string' ? entry.webmStatus : '';
  const previewStatus = typeof entry.previewStatus === 'string' ? entry.previewStatus : '';

  if (webmStatus === 'failed' || previewStatus === 'failed') {
    failedEntries += 1;
    continue;
  }
  if (webmStatus !== 'ready') {
    if (webmStatus.startsWith('blocked-') || previewStatus === 'blocked' ||
        webmStatus === 'pending' || previewStatus === 'pending') {
      blockedEntries += 1;
    } else {
      notReadyEntries += 1;
    }
    continue;
  }
  if (previewStatus === 'blocked' || previewStatus === 'pending') {
    blockedEntries += 1;
    continue;
  }
  if (previewStatus && previewStatus !== 'ready') {
    failedEntries += 1;
    continue;
  }

  const selected = resolveExactArchiveMedia(entry);
  if (!selected.ok) {
    staleReadyEntries += 1;
    continue;
  }

  const previewPath = String(entry.previewPath || (folder + '/' + entry.id))
    .replace(/\\/g, '/').replace(/\/+$/, '');
  const validPairs = selected.pairs.every((pair) =>
    validateArchiveMediaUrl(pair.webm, origin, previewPath, pair.webmName) &&
    validateArchiveMediaUrl(pair.poster, origin, previewPath, pair.posterName));
  if (!validPairs) {
    failedEntries += 1;
    continue;
  }
  candidates.push({ slot, previewPath, pairs: selected.pairs });
}

const baseSummary = {
  collections: folders.length,
  visibleEntries: visible.length,
  declaredReadyEntries: visible.filter(({ entry }) => entry.webmStatus === 'ready').length,
  readyEntries: candidates.length,
  blockedEntries,
  staleReadyEntries,
  failedEntries,
  notReadyEntries,
  mediaPairs: candidates.reduce((sum, item) => sum + item.pairs.length, 0),
  verifiedPairs: 0,
  blockedPairs: 0,
  failedPairs: 0,
  unattemptedPairs: 0,
  sourceMutations: 0,
};

let originStatus = 0;
let blockedReason = '';
try {
  const response = await fetch(archiveUrl, {
    cache: 'no-store',
    signal: AbortSignal.timeout(15000),
  });
  originStatus = response.status;
  if (!response.ok) blockedReason = 'PRODUCTION_ORIGIN_HTTP_' + response.status;
} catch (error) {
  blockedReason = error?.name === 'TimeoutError'
    ? 'PRODUCTION_ORIGIN_TIMEOUT'
    : 'PRODUCTION_ORIGIN_UNAVAILABLE';
}

if (blockedReason) {
  baseSummary.originStatus = originStatus;
  baseSummary.blockedReason = blockedReason;
  baseSummary.blockedPairs = baseSummary.mediaPairs;
  console.log('ARCHIVE_PRODUCTION_MEDIA_AUDIT=' + JSON.stringify(baseSummary));
  process.exitCode = classifyArchiveMediaHttpStatus(originStatus) === 'failed' ? 1 : 2;
} else {
  const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spine-archive-live-'));
  const tasks = candidates.flatMap((candidate) => candidate.pairs.map((pair) => ({
    slot: candidate.slot,
    previewPath: candidate.previewPath,
    ...pair,
  })));
  let cursor = 0;
  let mediaBlockedReason = '';

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

  async function worker() {
    while (cursor < tasks.length && !mediaBlockedReason) {
      const task = tasks[cursor];
      cursor += 1;
      const result = await verifyPair(task);
      if (result.classification === 'blocked' && !mediaBlockedReason) {
        mediaBlockedReason = result.code || 'PRODUCTION_MEDIA_BLOCKED';
      }
      if (result.ok) baseSummary.verifiedPairs += 1;
      else if (result.classification === 'blocked') baseSummary.blockedPairs += 1;
      else baseSummary.failedPairs += 1;
      console.log('ARCHIVE_MEDIA_PAIR=' + JSON.stringify({
        slot: task.slot,
        tier: task.tier,
        ok: Boolean(result.ok),
        code: result.code || '',
        webmBytes: result.webmBytes || 0,
        webpBytes: result.webpBytes || 0,
      }));
    }
  }

  try {
    await Promise.all(Array.from({ length: Math.min(4, tasks.length) }, () => worker()));
  } finally {
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  baseSummary.originStatus = originStatus;
  baseSummary.blockedReason = mediaBlockedReason;
  baseSummary.unattemptedPairs = Math.max(0, tasks.length -
    baseSummary.verifiedPairs - baseSummary.blockedPairs - baseSummary.failedPairs);
  baseSummary.blockedPairs += baseSummary.unattemptedPairs;
  console.log('ARCHIVE_PRODUCTION_MEDIA_AUDIT=' + JSON.stringify(baseSummary));

  if (mediaBlockedReason || baseSummary.staleReadyEntries > 0 ||
      baseSummary.failedEntries > 0 || baseSummary.failedPairs > 0 ||
      (baseSummary.readyEntries === 0 && baseSummary.visibleEntries > 0)) {
    process.exitCode = mediaBlockedReason ? 2 : baseSummary.failedEntries || baseSummary.failedPairs ? 1 : 2;
  }
}
