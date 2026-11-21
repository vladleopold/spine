#!/usr/bin/env node
// Verify the reported production previews without changing source assets or animation identity.
// Only aggregate counts and slot numbers are written to public CI logs.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readIndex} from './resolve-library.mjs';
import {
  classifyOriginHttpStatus,
  classifyPreviewHttpStatus,
  classifyReportedPreviewEntry,
} from './lib/reported-preview-live-status.mjs';
import {
  hasWebmSignature,
  hasWebpSignature,
  isSameWorkMediaPair,
} from './lib/reported-preview-media.mjs';

const reportedIds = [
  "boss_1-2026-11-14T20-07-17-943Z",
  "Spine-animation-2026-11-14T22-21-53-616Z",
  "Spine-animation-2026-11-17T05-25-45-640Z",
  "Spine-animation-2026-11-17T05-40-26-980Z",
  "wolf-2026-11-17T07-14-36-248Z",
  "wolf_v13-2026-11-17T15-57-55-338Z",
  "config-2026-11-17T17-15-57-407Z",
  "Spine-animation-2026-11-17T18-04-48-688Z",
  "Spine-animation-2026-11-17T17-50-04-803Z",
  "Spine-animation-2026-11-17T18-06-25-641Z",
  "Spine-animation-2026-11-17T18-07-35-146Z",
  "Spine-animation-2026-11-17T18-17-09-503Z",
  "Spine-animation-2026-11-17T18-19-06-491Z",
  "Spine-animation-2026-11-17T18-26-20-981Z",
  "Spine-animation-2026-11-17T18-26-38-201Z",
  "Spine-animation-2026-11-17T18-27-52-258Z",
  "Spine-animation-2026-11-17T18-36-51-976Z",
  "Spine-animation-2026-11-17T18-39-06-745Z",
];
const priorityId = "Spine-animation-2026-11-17T18-45-14-132Z";
const allIds = [...reportedIds, priorityId];
const entries = readIndex(process.cwd(), 'library_02') || [];
const summary = {
  requested: allIds.length,
  ready: 0,
  blocked: 0,
  failed: 0,
  mediaVerified: 0,
  postersDecoded: 0,
  motionVerified: 0,
};
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spine-reported-preview-live-'));
const motionVerifier = fileURLToPath(new URL('./verify-preview-motion.mjs', import.meta.url));
const posterVerifier = fileURLToPath(new URL('./verify-poster-first-frame.mjs', import.meta.url));
const auditNonce = Date.now();

async function fetchMedia(url, kind, destination) {
  if (!url || !url.startsWith('https://spine-link.vercel.app/assets/library_02/')) {
    return { state: 'failed', reason: 'invalid-public-asset-url' };
  }
  let response;
  try {
    response = await fetch(url + (url.includes('?') ? '&' : '?') + 'audit=' + auditNonce, {
      signal: AbortSignal.timeout(20000),
      cache: 'no-store',
    });
  } catch {
    return { state: 'blocked', reason: 'transport-unavailable' };
  }
  const httpClass = classifyPreviewHttpStatus(response.status);
  if (httpClass !== 'ok') {
    return { state: httpClass, reason: 'http-status' };
  }
  let bytes;
  try {
    bytes = Buffer.from(await response.arrayBuffer());
  } catch {
    return { state: 'blocked', reason: 'body-unavailable' };
  }
  const valid = kind === 'webm' ? hasWebmSignature(bytes) : hasWebpSignature(bytes);
  if (!valid) return { state: 'failed', reason: 'invalid-media-signature' };
  fs.writeFileSync(destination, bytes);
  summary.mediaVerified += 1;
  return { state: 'ok' };
}

function decodePoster(file) {
  const result = JSON.parse(execFileSync('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height', '-of', 'json', file,
  ], { encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'ignore'] }));
  const stream = result.streams?.[0] || {};
  if (!(Number(stream.width) > 0 && Number(stream.height) > 0)) {
    throw new Error('poster-dimensions');
  }
  execFileSync('ffmpeg', ['-v', 'error', '-i', file, '-frames:v', '1', '-f', 'null', '-'], {
    stdio: 'ignore',
    timeout: 30000,
  });
  summary.postersDecoded += 1;
}

function verifyMotion(file) {
  const result = JSON.parse(execFileSync('ffprobe', [
    '-v', 'error', '-count_frames', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,nb_read_frames:format=duration', '-of', 'json', file,
  ], { encoding: 'utf8', timeout: 30000, stdio: ['ignore', 'pipe', 'ignore'] }));
  const stream = result.streams?.[0] || {};
  const frames = Number(stream.nb_read_frames);
  const duration = Number(result.format?.duration);
  if (!(Number(stream.width) > 0 && Number(stream.height) > 0 && frames >= 8 &&
      duration >= 0.5 && frames / duration >= 15)) {
    throw new Error('video-frame-count-or-duration');
  }
  execFileSync(process.execPath, [motionVerifier, file], { stdio: 'ignore', timeout: 120000 });
  summary.motionVerified += 1;
}

try {
  let originStatus = 0;
  try {
    const response = await fetch('https://spine-link.vercel.app/', {
      cache: 'no-store',
      signal: AbortSignal.timeout(15000),
    });
    originStatus = response.status;
  } catch {
    originStatus = 0;
  }

  if (classifyOriginHttpStatus(originStatus) !== 'ok') {
    summary.blocked = allIds.length;
    summary.blockedReason = originStatus
      ? 'PRODUCTION_ORIGIN_HTTP_' + originStatus
      : 'PRODUCTION_ORIGIN_UNREACHABLE';
    console.log('REPORTED_PREVIEW_PRODUCTION_AUDIT=' + JSON.stringify(summary));
    console.error('REPORTED_PREVIEW_PRODUCTION_BLOCKED reason=' + summary.blockedReason);
    process.exitCode = 2;
  } else {
    for (let slot = 0; slot < allIds.length; slot += 1) {
      const id = allIds[slot];
      const entry = entries.find((item) => item && item.id === id);
      if (!entry) {
        summary.failed += 1;
        console.error('REPORTED_PREVIEW_LIVE_FAILED slot=' + slot + ' reason=SOURCE_INDEX_MISSING');
        continue;
      }

      const readiness = classifyReportedPreviewEntry(entry);
      if (readiness !== 'ready') {
        if (readiness === 'blocked') {
          summary.blocked += 1;
          console.log('REPORTED_PREVIEW_LIVE_BLOCKED slot=' + slot + ' reason=SOURCE_STATUS');
        } else {
          summary.failed += 1;
          console.error('REPORTED_PREVIEW_LIVE_FAILED slot=' + slot + ' reason=SOURCE_STATUS');
        }
        continue;
      }

      const webmUrl = entry.webmPreview;
      const webpUrl = entry.webpPoster || entry.thumbnailPoster || '';
      if (!isSameWorkMediaPair(webmUrl, webpUrl)) {
        summary.failed += 1;
        console.error('REPORTED_PREVIEW_LIVE_FAILED slot=' + slot + ' reason=MEDIA_PAIR_MISMATCH');
        continue;
      }

      const videoFile = path.join(tempDir, 'video-' + slot + '.webm');
      const posterFile = path.join(tempDir, 'poster-' + slot + '.webp');
      const videoResult = await fetchMedia(webmUrl, 'webm', videoFile);
      if (videoResult.state !== 'ok') {
        if (videoResult.state === 'blocked') summary.blocked += 1;
        else summary.failed += 1;
        console.error('REPORTED_PREVIEW_LIVE_' + videoResult.state.toUpperCase() +
          ' slot=' + slot + ' kind=webm reason=' + videoResult.reason);
        continue;
      }

      const posterResult = await fetchMedia(webpUrl, 'webp', posterFile);
      if (posterResult.state !== 'ok') {
        if (posterResult.state === 'blocked') summary.blocked += 1;
        else summary.failed += 1;
        console.error('REPORTED_PREVIEW_LIVE_' + posterResult.state.toUpperCase() +
          ' slot=' + slot + ' kind=webp reason=' + posterResult.reason);
        continue;
      }

      try {
        decodePoster(posterFile);
        verifyMotion(videoFile);
        execFileSync(process.execPath, [posterVerifier, videoFile, posterFile], {
          stdio: 'ignore',
          timeout: 60000,
        });
        summary.ready += 1;
        console.log('REPORTED_PREVIEW_LIVE_OK slot=' + slot);
      } catch {
        summary.failed += 1;
        console.error('REPORTED_PREVIEW_LIVE_FAILED slot=' + slot + ' reason=DECODE_OR_MOTION');
      }
    }

    console.log('REPORTED_PREVIEW_PRODUCTION_AUDIT=' + JSON.stringify(summary));
    process.exitCode = summary.failed > 0 ? 1 : summary.blocked > 0 ? 2 : 0;
  }
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}
