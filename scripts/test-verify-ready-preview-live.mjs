#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  listVisibleArchiveEntries,
  resolveExactArchiveMedia,
  validateArchiveMediaUrl,
  classifyArchiveMediaHttpStatus,
  hasWebmSignature,
  hasWebpSignature,
} from './lib/archive-live-media-audit.mjs';

const base = 'https://spine-link.vercel.app/assets/library_02/work-a/';
const media = {
  webmPreview: base + 'preview.webm',
  webpPoster: base + 'preview.webp',
  webmPreviewMedium: base + 'preview-medium.webm',
  webpPosterMedium: base + 'preview-medium.webp',
  webmPreviewLow: base + 'preview-low.webm',
  webpPosterLow: base + 'preview-low.webp',
};
const collections = [
  { folder: 'library_01', entries: [
    { id: 'one', ...media },
    { id: 'hidden', hiddenFromPublicLibrary: true },
    { id: 'test', testOnly: true },
  ] },
  { folder: 'library_02', entries: Array.from({ length: 14 }, (_, i) => ({ id: 'work-' + i })) },
];
const visible = listVisibleArchiveEntries(collections);
assert.equal(visible.length, 15, 'the audit must retain all public entries across every shard');
assert.equal(visible[0].folder, 'library_01');
assert.equal(visible[14].folder, 'library_02');

const exact = resolveExactArchiveMedia({
  defaultAnimation: ' Walk ',
  allAnimationPreviews: {
    ' Walk ': media,
    Walk: { webmPreview: base + 'wrong.webm', webpPoster: base + 'wrong.webp' },
  },
});
assert.equal(exact.ok, true);
assert.equal(exact.animation, ' Walk ', 'selected animation identity must remain byte-for-byte exact');
assert.deepEqual(exact.pairs.map((pair) => pair.tier), ['high', 'medium', 'low']);

assert.equal(resolveExactArchiveMedia({
  defaultAnimation: '',
  allAnimationPreviews: { Walk: media },
}).reason, 'MISSING_DEFAULT_ANIMATION');

assert.equal(resolveExactArchiveMedia({
  defaultAnimation: 'Missing',
  allAnimationPreviews: { Walk: media },
  webmPreview: media.webmPreview,
  webpPoster: media.webpPoster,
}).reason, 'MISSING_EXACT_ANIMATION_MEDIA',
  'a missing exact key must not borrow legacy or alternate-animation media');

assert.equal(resolveExactArchiveMedia({
  defaultAnimation: 'Walk',
  webmPreview: media.webmPreview,
  thumbnailPoster: base + 'thumbnail.webp',
}).pairs[0].posterName, 'thumbnail.webp',
  'legacy WebP thumbnail fallback is accepted only with an explicit default and no animation map');

assert.equal(resolveExactArchiveMedia({
  defaultAnimation: 'Walk',
  webmPreview: media.webmPreview,
  thumbnailPoster: base + 'thumbnail.png',
}).reason, 'NON_WEBP_POSTER');

assert.equal(resolveExactArchiveMedia({
  defaultAnimation: 'Walk',
  webmPreview: media.webmPreview,
}).reason, 'INCOMPLETE_EXACT_MEDIA_PAIR');

assert.equal(validateArchiveMediaUrl(
  base + 'preview.webm?v=live',
  'https://spine-link.vercel.app',
  'library_02/work-a',
  'preview.webm',
), true);
assert.equal(validateArchiveMediaUrl(
  base + 'preview.webm',
  'https://spine-link.vercel.app',
  'library_02/work-b',
  'preview.webm',
), false);
assert.equal(validateArchiveMediaUrl(
  'https://example.invalid/assets/library_02/work-a/preview.webm',
  'https://spine-link.vercel.app',
  'library_02/work-a',
  'preview.webm',
), false);

assert.equal(classifyArchiveMediaHttpStatus(206), 'ok');
assert.equal(classifyArchiveMediaHttpStatus(402), 'blocked');
assert.equal(classifyArchiveMediaHttpStatus(403), 'blocked');
assert.equal(classifyArchiveMediaHttpStatus(404), 'failed');
assert.equal(classifyArchiveMediaHttpStatus(503), 'blocked');

assert.equal(hasWebmSignature(Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, ...new Array(128).fill(0)])), true);
assert.equal(hasWebpSignature(Uint8Array.from([
  0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
  ...new Array(120).fill(0),
])), true);

const script = fs.readFileSync(new URL('./verify-ready-preview-live.mjs', import.meta.url), 'utf8');
const workflow = fs.readFileSync(new URL('../.github/workflows/verify-spine-production-media.yml', import.meta.url), 'utf8');
assert.match(script, /listVisibleArchiveEntries/);
assert.doesNotMatch(script, /\.slice\(\s*0\s*,\s*10\s*\)/,
  'the production audit must not stop at the newest ten entries');
assert.match(script, /verify-preview-motion\.mjs/);
assert.match(script, /verify-poster-first-frame\.mjs/);
assert.match(script, /world-spine-archive/);
assert.match(workflow, /cron:\s*'47 \* \* \* \*'/,
  'the full-archive production audit must run hourly');
assert.match(workflow, /node scripts\/verify-ready-preview-live\.mjs/);
assert.match(workflow, /scripts\/lib\/archive-live-media-audit\.mjs/);
assert.doesNotMatch(script, /console\.log\([^\n]*(?:entry\.id|entry\.defaultAnimation|previewPath)/,
  'public audit logs must not expose work names or private source paths');

console.log('PASS full-archive audit: every public shard, exact animation pairs, real WebM motion and WebP first-frame decoding');
