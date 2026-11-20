import assert from 'node:assert/strict';
import fs from 'node:fs';
import {fileURLToPath} from 'node:url';
import {
  hasWebmSignature,
  hasWebpSignature,
  isSameWorkMediaPair,
} from './lib/reported-preview-media.mjs';

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
assert.equal(isSameWorkMediaPair('https://raw.githubusercontent.com/vladleopold/spine/main/library_02/work-a/preview.webm', root + 'preview.webp'), false);

const read = path => fs.readFileSync(fileURLToPath(new URL(path, import.meta.url)), 'utf8');
const verifier = read('./verify-reported-preview-live.mjs');
const verifyWorkflow = read('../.github/workflows/verify-reported-preview-live.yml');
const repairWorkflow = read('../.github/workflows/repair-reported-previews.yml');
const idsBlock = verifier.match(/const ids=\[([\s\S]*?)\];/);
assert.ok(idsBlock, 'retain the explicit reported-work manifest');
assert.equal((idsBlock[1].match(/"/g) || []).length / 2, 18, 'keep all 18 reported works');
assert.match(verifier, /const priorityId=/, 'audit the separately prioritized work too');
assert.match(verifier, /verify-preview-motion\.mjs/, 'decode and compare real moving frames');
assert.match(verifier, /verify-poster-first-frame\.mjs/, 'verify each poster against its own video frame zero');
assert.match(verifier, /ffprobe/);
assert.match(verifier, /ffmpeg/);
assert.match(verifier, /isSameWorkMediaPair/);
assert.doesNotMatch(verifier, /REPORTED_PREVIEW_LIVE_OK[^\n]*\bid\b|PREVIEW_NOT_READY[^\n]*\bid\b/,
  'never print private work identifiers in public action logs');
assert.match(verifyWorkflow, /schedule:\s*\n\s+- cron: '\d+ \* \* \* \*'/);
assert.match(verifyWorkflow, /\/scripts\/verify-preview-motion\.mjs/);
assert.match(verifyWorkflow, /\/scripts\/verify-poster-first-frame\.mjs/);
assert.match(verifyWorkflow, /apt-get install[^\n]*ffmpeg|command -v ffmpeg/);
assert.match(repairWorkflow, /pull_request:/);
assert.match(repairWorkflow, /test-reported-preview-live\.mjs/);
console.log('PASS reported-preview audit: same-work pairs, real decode/motion, first-frame match, hourly schedule, privacy-safe logs');
