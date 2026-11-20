#!/usr/bin/env node
// Verify every public rendition and reconcile ready status only after live acceptance.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { readIndex } from './resolve-library.mjs';
import { choosePreviewAnimation } from './preview-animation-choice.mjs';
import { reconcileReportedPreviewLiveStatus } from './lib/reported-preview-live-status.mjs';

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
const assetSpecs = [
  ['preview.webm', 'webmPreview', 'webm'],
  ['preview-medium.webm', 'webmPreviewMedium', 'webm'],
  ['preview-low.webm', 'webmPreviewLow', 'webm'],
  ['preview.webp', 'webpPoster', 'webp'],
  ['preview-medium.webp', 'webpPosterMedium', 'webp'],
  ['preview-low.webp', 'webpPosterLow', 'webp'],
];
const videoPairs = [
  ['preview.webm', 'preview.webp'],
  ['preview-medium.webm', 'preview-medium.webp'],
  ['preview-low.webm', 'preview-low.webp'],
];
const entries = readIndex(process.cwd(), 'library_02') || [];
const indexPath = path.join(process.cwd(), 'library_02', 'index.json');
const verifiedAt = new Date().toISOString();
let ready = 0, blocked = 0, failed = 0, mediaVerified = 0, expectedMedia = 0;

function signature(kind, bytes) {
  if (kind === 'webm') return bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
  return bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
}

function runLocalVerifier(script, ...args) {
  try {
    execFileSync(process.execPath, [script, ...args], {
      cwd: process.cwd(), encoding: 'utf8', timeout: 180000, maxBuffer: 2 * 1024 * 1024,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return true;
  } catch {
    return false;
  }
}

async function verifyRecord(record, slot) {
  const selected = choosePreviewAnimation([], record.defaultAnimation);
  if (!selected) return { ok: false, code: 'MISSING_EXACT_ANIMATION', mediaVerified: 0 };
  const map = record.allAnimationPreviews && record.allAnimationPreviews[selected];
  if (!map) return { ok: false, code: 'ANIMATION_MEDIA_MAP_MISSING', mediaVerified: 0 };
  for (const [name, field] of [
    ['preview.webm', 'webmPreview'],
    ['preview-medium.webm', 'webmPreviewMedium'],
    ['preview-low.webm', 'webmPreviewLow'],
    ['preview.webp', 'webpPoster'],
    ['preview-medium.webp', 'webpPosterMedium'],
    ['preview-low.webp', 'webpPosterLow'],
  ]) {
    if (!record[field] || map[field] !== record[field]) {
      return { ok: false, code: 'ANIMATION_MEDIA_MAP_MISMATCH', mediaVerified: 0 };
    }
  }

  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'spine-reported-live-'));
  const hashes = {};
  let count = 0;
  try {
    for (const [name, field, kind] of assetSpecs) {
      const url = record[field];
      if (typeof url !== 'string' || !url.startsWith('https://spine-link.vercel.app/assets/')) {
        return { ok: false, code: 'PUBLIC_ASSET_URL_INVALID', mediaVerified: count };
      }
      let response;
      try {
        const separator = url.includes('?') ? '&' : '?';
        response = await fetch(url + separator + 'check=' + encodeURIComponent(record.webmGeneratedAt || String(slot)), {
          cache: 'no-store', signal: AbortSignal.timeout(15000),
        });
      } catch {
        return { ok: false, code: 'PUBLIC_ASSET_NETWORK_ERROR', mediaVerified: count };
      }
      if (!response.ok) return { ok: false, code: 'HTTP_' + response.status, mediaVerified: count };
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length < 256 || !signature(kind, bytes)) {
        return { ok: false, code: 'PUBLIC_ASSET_SIGNATURE_OR_SIZE', mediaVerified: count };
      }
      const sha256 = createHash('sha256').update(bytes).digest('hex');
      const expected = record.previewAssetHashes?.[name]?.sha256;
      if (expected && expected !== sha256) {
        return { ok: false, code: 'PUBLIC_ASSET_SHA256_MISMATCH', mediaVerified: count };
      }
      fs.writeFileSync(path.join(temp, name), bytes);
      hashes[name] = { sha256, bytes: bytes.length };
      count++;
    }

    for (const [video, poster] of videoPairs) {
      const videoPath = path.join(temp, video);
      const posterPath = path.join(temp, poster);
      if (!runLocalVerifier('scripts/verify-preview-motion.mjs', videoPath)) {
        return { ok: false, code: 'MOTION_REJECTED', mediaVerified: count };
      }
      if (!runLocalVerifier('scripts/verify-poster-first-frame.mjs', videoPath, posterPath)) {
        return { ok: false, code: 'POSTER_FRAME_MISMATCH', mediaVerified: count };
      }
    }
    return { ok: true, code: '', mediaVerified: count, hashes };
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
}

for (let slot = 0; slot < ids.length; slot++) {
  const record = entries.find(item => item.id === ids[slot]);
  expectedMedia += assetSpecs.length;
  if (!record) {
    failed++;
    console.error('SOURCE_INDEX_MISSING slot=' + slot);
    continue;
  }
  const current = String(record.webmStatus || '');
  if (current.startsWith('blocked-') || current === 'blocked') {
    reconcileReportedPreviewLiveStatus(record, { ok: false, mediaVerified: 0, code: current }, verifiedAt);
    blocked++;
    console.log('PREVIEW_NOT_READY slot=' + slot + ' state=' + current);
    continue;
  }
  if (current !== 'ready' && current !== 'pending-live') {
    failed++;
    console.error('PREVIEW_NOT_READY slot=' + slot + ' state=' + (current || 'pending'));
    continue;
  }
  const result = await verifyRecord(record, slot);
  mediaVerified += result.mediaVerified;
  const status = reconcileReportedPreviewLiveStatus(record, result, verifiedAt);
  if (status === 'ready') {
    record.previewAssetHashes = result.hashes;
    ready++;
    console.log('REPORTED_PREVIEW_LIVE_OK slot=' + slot + ' assets=' + result.mediaVerified);
  } else {
    failed++;
    console.error('REPORTED_PREVIEW_LIVE_FAILED slot=' + slot + ' code=' + result.code);
  }
}

fs.writeFileSync(indexPath, JSON.stringify(entries, null, 2) + '\n');
const summary = { requested: ids.length, ready, blocked, failed, mediaVerified, expectedMedia };
console.log('REPORTED_PREVIEW_PRODUCTION_AUDIT=' + JSON.stringify(summary));
if (ready + blocked + failed !== ids.length || failed > 0 || blocked > 0 || mediaVerified !== expectedMedia) {
  process.exitCode = 1;
}
