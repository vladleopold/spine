import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {
  hasWebmSignature,
  hasWebpSignature,
  isSameWorkMediaPair,
} from './lib/reported-preview-media.mjs';
import {
  classifyOriginHttpStatus,
  classifyPreviewHttpStatus,
  classifyReportedPreviewEntry,
} from './lib/reported-preview-live-status.mjs';

const webm = new Uint8Array(256);
webm.set([0x1a, 0x45, 0xdf, 0xa3]);
const webp = new Uint8Array(256);
webp.set([0x52, 0x49, 0x46, 0x46]);
webp.set([0x57, 0x45, 0x42, 0x50], 8);

assert.equal(hasWebmSignature(webm), true);
assert.equal(hasWebpSignature(webp), true);
assert.equal(hasWebmSignature(webm.subarray(0, 255)), false);
assert.equal(hasWebpSignature(new Uint8Array(256)), false);

const root = 'https://spine-link.vercel.app/assets/library_02/work-a/';
assert.equal(isSameWorkMediaPair(root + 'preview.webm', root + 'preview.webp'), true);
assert.equal(isSameWorkMediaPair(root + 'preview-medium.webm', root + 'preview-medium.webp'), true);
assert.equal(isSameWorkMediaPair(root + 'preview-low.webm', root + 'preview-low.webp'), true);
assert.equal(isSameWorkMediaPair(root + 'preview.webm', root + 'preview-low.webp'), false);
assert.equal(isSameWorkMediaPair(root + 'preview.webm', root.replace('work-a', 'work-b') + 'preview.webp'), false);
assert.equal(isSameWorkMediaPair(
  'https://raw.githubusercontent.com/vladleopold/spine/main/library_02/work-a/preview.webm',
  root + 'preview.webp',
), false);

assert.equal(classifyOriginHttpStatus(200), 'ok');
assert.equal(classifyOriginHttpStatus(402), 'blocked');
assert.equal(classifyPreviewHttpStatus(402), 'blocked');
assert.equal(classifyPreviewHttpStatus(404), 'failed');
assert.equal(classifyReportedPreviewEntry({webmStatus: 'ready'}), 'blocked',
  'a legacy record without previewStatus must remain blocked until exact media is revalidated');
assert.equal(classifyReportedPreviewEntry({webmStatus: 'ready', previewStatus: 'ready'}), 'ready');
assert.equal(classifyReportedPreviewEntry({webmStatus: 'ready', previewStatus: 'pending'}), 'blocked');
assert.equal(classifyReportedPreviewEntry({webmStatus: 'ready', previewStatus: 'blocked'}), 'blocked');
assert.equal(classifyReportedPreviewEntry({webmStatus: 'ready', previewStatus: 'failed'}), 'failed');
assert.equal(classifyReportedPreviewEntry({webmStatus: 'pending', previewStatus: 'pending'}), 'blocked');

const read = (path) => fs.readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
const verifier = read('./verify-reported-preview-live.mjs');
const idsBlock = verifier.match(/const reportedIds = \[([\s\S]*?)\];/);
assert.ok(idsBlock, 'retain the explicit reported-work manifest');
assert.equal((idsBlock[1].match(/"/g) || []).length / 2, 18, 'keep all 18 reported works');
assert.match(verifier, /const priorityId =/,
  'audit the separately prioritized work too');
assert.match(verifier, /classifyOriginHttpStatus\(originStatus\)/,
  'a blocked production origin must block the whole audit');
assert.match(verifier, /classifyPreviewHttpStatus\(response\.status\)/,
  'temporary asset HTTP responses must be classified as blocked, not broken media');
assert.match(verifier, /classifyReportedPreviewEntry\(entry\)/,
  'source statuses must use the canonical strict classifier');
assert.match(verifier, /verify-preview-motion\.mjs/,
  'decode and compare real moving frames');
assert.match(verifier, /verify-poster-first-frame\.mjs/,
  'verify each poster against its own video frame zero');
assert.match(verifier, /PREVIEW_LIVE_OK slot=/,
  'public logs may contain slot numbers only');
assert.doesNotMatch(verifier, /PREVIEW_LIVE_(?:OK|FAILED|BLOCKED)[^\n]*\bid=/,
  'never print private work identifiers in public action logs');

console.log('PASS reported-preview audit classification, exact pairs, real motion and poster identity');
