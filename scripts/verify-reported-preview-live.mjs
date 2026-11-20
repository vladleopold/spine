#!/usr/bin/env node
// Verify exact selected-animation media from production. Temporary downloads are
// decoded in the runner and removed; no source names, URLs, frames or media are logged.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { readIndex } from './resolve-library.mjs';
import {
  classifyPublishedPreview,
  validateDecodedVideo,
  validateMediaSignature,
} from './lib/reported-preview-acceptance.mjs';

const ids = [
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

const entries = readIndex(process.cwd(), 'library_02') || [];
const tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'spine-live-acceptance-'));
const summary = {
  requested: ids.length,
  ready: 0,
  blocked: 0,
  failed: 0,
  mediaVerified: 0,
  decodedTiers: 0,
  motionVerified: 0,
  posterMatched: 0,
};

async function downloadAsset(url, kind, slot, tier) {
  const cacheKey = encodeURIComponent(String(slot) + '-' + tier);
  const separator = url.includes('?') ? '&' : '?';
  let response;
  try {
    response = await fetch(url + separator + 'audit=' + cacheKey, {
      cache: 'no-store',
      signal: AbortSignal.timeout(20000),
    });
  } catch {
    throw new Error('MEDIA_FETCH_FAILED');
  }
  if (!response.ok) throw new Error('HTTP_' + response.status);
  const declaredLength = Number(response.headers.get('content-length') || 0);
  if (declaredLength > 200 * 1024 * 1024) throw new Error('MEDIA_TOO_LARGE');
  let bytes;
  try {
    bytes = new Uint8Array(await response.arrayBuffer());
  } catch {
    throw new Error('MEDIA_DOWNLOAD_INCOMPLETE');
  }
  if (!validateMediaSignature(kind, bytes)) throw new Error('MEDIA_SIGNATURE_INVALID');
  const extension = kind === 'webm' ? 'webm' : 'webp';
  const file = path.join(tempDir, `slot-${slot}-${tier}.${extension}`);
  fs.writeFileSync(file, bytes);
  summary.mediaVerified++;
  return file;
}

function decodeAndValidate(videoPath) {
  let probe;
  try {
    probe = JSON.parse(execFileSync('ffprobe', [
      '-v', 'error',
      '-count_frames',
      '-select_streams', 'v:0',
      '-show_entries', 'stream=width,height,nb_read_frames:format=duration',
      '-of', 'json',
      videoPath,
    ], {
      encoding: 'utf8',
      timeout: 60000,
      stdio: ['ignore', 'pipe', 'ignore'],
    }));
  } catch {
    throw new Error('VIDEO_DECODE_FAILED');
  }
  const stream = probe.streams?.[0] || {};
  if (!validateDecodedVideo(stream, probe.format?.duration)) {
    throw new Error('VIDEO_FRAME_COUNT_REJECTED');
  }
  summary.decodedTiers++;
}

function verifyMotion(videoPath) {
  try {
    execFileSync(process.execPath, [
      path.join(process.cwd(), 'scripts/verify-preview-motion.mjs'),
      videoPath,
    ], { stdio: 'ignore', timeout: 120000 });
  } catch {
    throw new Error('VIDEO_MOTION_REJECTED');
  }
  summary.motionVerified++;
}

function verifyPoster(videoPath, posterPath) {
  try {
    execFileSync(process.execPath, [
      path.join(process.cwd(), 'scripts/verify-poster-first-frame.mjs'),
      videoPath,
      posterPath,
    ], { stdio: 'ignore', timeout: 120000 });
  } catch {
    throw new Error('POSTER_FIRST_FRAME_MISMATCH');
  }
  summary.posterMatched++;
}

try {
  for (let index = 0; index < ids.length; index += 1) {
    const slot = index + 1;
    const entry = entries.find((item) => item.id === ids[index]);
    if (!entry) {
      summary.failed++;
      console.error('SOURCE_INDEX_MISSING slot=' + slot);
      continue;
    }

    const decision = classifyPublishedPreview(entry);
    if (decision.status === 'blocked') {
      summary.blocked++;
      console.log('PREVIEW_BLOCKED slot=' + slot + ' reason=' + decision.reason);
      continue;
    }
    if (decision.status !== 'ready') {
      summary.failed++;
      console.error('PREVIEW_NOT_ACCEPTED slot=' + slot + ' reason=' + decision.reason);
      continue;
    }

    try {
      for (const tier of decision.tiers) {
        const videoPath = await downloadAsset(tier.webmUrl, 'webm', slot, tier.name);
        const posterPath = await downloadAsset(tier.posterUrl, 'webp', slot, tier.name);
        decodeAndValidate(videoPath);
        verifyMotion(videoPath);
        verifyPoster(videoPath, posterPath);
      }
      summary.ready++;
      console.log('REPORTED_PREVIEW_LIVE_ACCEPTED slot=' + slot);
    } catch (error) {
      summary.failed++;
      const code = String(error?.message || 'MEDIA_ACCEPTANCE_FAILED');
      console.error('REPORTED_PREVIEW_LIVE_FAILED slot=' + slot + ' code=' + code);
    }
  }
} finally {
  fs.rmSync(tempDir, { recursive: true, force: true });
}

console.log('REPORTED_PREVIEW_PRODUCTION_AUDIT=' + JSON.stringify(summary));
if (summary.ready + summary.blocked + summary.failed !== summary.requested ||
    summary.failed > 0 || summary.blocked > 0) {
  process.exitCode = 1;
}
