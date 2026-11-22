#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  classifyArchiveEntryStatus,
  listVisibleArchiveEntries,
  selectArchiveMediaPreflight,
  shouldRunArchiveMediaAudit,
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
  { folder: 'library_02', entries: [
    ...Array.from({ length: 14 }, (_, i) => ({ id: 'work-' + i, thumbnailPoster: base + 'legacy.webp' })),
    { id: 'map-only', allAnimationPreviews: { Walk: {} } },
    { id: 'metadata-missing' },
  ] },
];
const visible = listVisibleArchiveEntries(collections);
assert.equal(visible.length, 16, 'the audit must retain every public card across every shard, but exclude records the archive API cannot display');
assert.equal(visible[0].folder, 'library_01');
assert.equal(visible[14].folder, 'library_02');
assert.equal(visible.some((item) => item.entry.id === 'map-only'), true,
  'an exact-animation map is public archive metadata even when its selected media is blocked');
assert.equal(visible.some((item) => item.entry.id === 'metadata-missing'), false,
  'records with no archive preview metadata are not public cards and must not be inspected');

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

const mediumLowOnly = resolveExactArchiveMedia({
  defaultAnimation: 'Walk',
  webmPreviewMedium: media.webmPreviewMedium,
  webpPosterMedium: media.webpPosterMedium,
  webmPreviewLow: media.webmPreviewLow,
  webpPosterLow: media.webpPosterLow,
});
assert.equal(mediumLowOnly.ok, true,
  'a same-animation medium/low pair is valid when the high tier is absent');
assert.deepEqual(mediumLowOnly.pairs.map((pair) => pair.tier), ['medium', 'low']);

const highIncompleteWithValidLowerTiers = resolveExactArchiveMedia({
  defaultAnimation: 'Walk',
  webmPreview: media.webmPreview,
  webmPreviewMedium: media.webmPreviewMedium,
  webpPosterMedium: media.webpPosterMedium,
  webmPreviewLow: media.webmPreviewLow,
  webpPosterLow: media.webpPosterLow,
});
assert.equal(highIncompleteWithValidLowerTiers.ok, true,
  'an incomplete high tier must not hide complete exact-animation medium/low pairs');
assert.deepEqual(highIncompleteWithValidLowerTiers.incompleteTiers, ['high']);
assert.deepEqual(highIncompleteWithValidLowerTiers.pairs.map((pair) => pair.tier), ['medium', 'low']);

const invalidHighWithValidLowerTiers = resolveExactArchiveMedia({
  defaultAnimation: 'Walk',
  webmPreview: media.webmPreview,
  webpPoster: base + 'preview.png',
  webmPreviewMedium: media.webmPreviewMedium,
  webpPosterMedium: media.webpPosterMedium,
});
assert.equal(invalidHighWithValidLowerTiers.ok, true,
  'a non-WebP high poster must not suppress a valid same-animation medium pair');
assert.deepEqual(invalidHighWithValidLowerTiers.invalidTiers, ['high']);
assert.deepEqual(invalidHighWithValidLowerTiers.pairs.map((pair) => pair.tier), ['medium']);

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

assert.equal(classifyArchiveEntryStatus({ webmStatus: 'ready' }), 'failed',
  'a ready WebM without previewStatus=ready is hidden by the archive UI and must not be counted ready');
assert.equal(classifyArchiveEntryStatus({ webmStatus: 'ready', previewStatus: 'ready' }), 'ready');
assert.equal(classifyArchiveEntryStatus({ webmStatus: 'ready', previewStatus: '' }), 'failed');
assert.equal(classifyArchiveEntryStatus({ webmStatus: 'ready', previewStatus: 'failed' }), 'failed');
assert.equal(classifyArchiveEntryStatus({ webmStatus: 'failed', previewStatus: 'failed' }), 'failed');
assert.equal(classifyArchiveEntryStatus({ webmStatus: 'error' }), 'failed');
assert.equal(classifyArchiveEntryStatus({ webmStatus: 'blocked-missing-source', previewStatus: 'blocked' }), 'blocked');
assert.equal(classifyArchiveEntryStatus({ webmStatus: 'pending' }), 'blocked');

const failedButExact = {
  defaultAnimation: 'Walk',
  webmStatus: 'failed',
  previewStatus: 'failed',
  webmPreview: media.webmPreview,
  webpPoster: media.webpPoster,
};
assert.equal(classifyArchiveEntryStatus(failedButExact), 'failed');
assert.equal(resolveExactArchiveMedia(failedButExact).ok, true,
  'a failed status must not suppress byte-level inspection of its exact selected media');

const preflightCandidates = [
  { folder: 'library_01', slot: 1, status: 'failed', previewPath: 'library_01/a', pairs: [{ tier: 'high', webm: 'a.webm', poster: 'a.webp' }] },
  { folder: 'library_01', slot: 2, status: 'ready', previewPath: 'library_01/b', pairs: [{ tier: 'high', webm: 'b.webm', poster: 'b.webp' }] },
  { folder: 'library_02', slot: 3, status: 'blocked', previewPath: 'library_02/c', pairs: [{ tier: 'high', webm: 'c.webm', poster: 'c.webp' }] },
];
const preflight = selectArchiveMediaPreflight(preflightCandidates, 4);
assert.deepEqual(preflight.map((item) => item.slot), [2, 3],
  'preflight probes one exact high-quality pair per collection');
assert.equal(shouldRunArchiveMediaAudit(402, [{ ok: false, classification: 'blocked' }], 2), false,
  'when the page and every sampled media pair are blocked, stop before a full archive sweep');
assert.equal(shouldRunArchiveMediaAudit(402, [{ ok: true }], 2), true,
  'a blocked HTML route must not suppress a full media audit when a static pair is reachable');
assert.equal(shouldRunArchiveMediaAudit(402, [{ ok: false, classification: 'failed' }], 2), true,
  'an individual missing asset must not suppress checks of the remaining archive');
assert.equal(shouldRunArchiveMediaAudit(200, [], 2), true);
assert.equal(shouldRunArchiveMediaAudit(402, [], 0), false);

assert.equal(resolveExactArchiveMedia({
  defaultAnimation: '__proto__',
  allAnimationPreviews: {},
}).reason, 'MISSING_EXACT_ANIMATION_MEDIA',
  'inherited object properties must not satisfy an exact animation-map lookup');

assert.equal(hasWebmSignature(Uint8Array.from([0x1a, 0x45, 0xdf, 0xa3, ...new Array(128).fill(0)])), true);
assert.equal(hasWebpSignature(Uint8Array.from([
  0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50,
  ...new Array(120).fill(0),
])), true);

const script = fs.readFileSync(new URL('./verify-ready-preview-live.mjs', import.meta.url), 'utf8');
const workflow = fs.readFileSync(new URL('../.github/workflows/verify-spine-production-media.yml', import.meta.url), 'utf8');
const reportedWorkflow = fs.readFileSync(new URL('../.github/workflows/repair-reported-previews.yml', import.meta.url), 'utf8');
assert.doesNotMatch(script, /readIndex\(root, '\.'\)/,
  'the public archive API does not expose the repository-root index');
assert.doesNotMatch(script, /\\brootIndex\\b/,
  'the full-archive audit must not reference an undefined root index that is intentionally excluded from public collections');
assert.doesNotMatch(script, /includeRootArchiveIndex/,
  'the hourly audit must cover only collections the public archive actually reads');
assert.match(script, /selectArchiveMediaPreflight/);
assert.match(script, /shouldRunArchiveMediaAudit/);
assert.match(script, /classifyArchiveEntryStatus\(entry\)/);
assert.match(script, /incompleteTierEntries/);
assert.match(script, /invalidTierEntries/);
const statusAuditBlock = script.slice(script.indexOf("const status = classifyArchiveEntryStatus(entry)"),
  script.indexOf("const selected = resolveExactArchiveMedia(entry)"));
assert.doesNotMatch(statusAuditBlock, /continue/,
  'failed and blocked status labels must not suppress exact media inspection');
assert.match(script, /await Promise\.all\(preflightTasks\.map\(\(task\) => verifyPair\(task\)\)\)/);
assert.doesNotMatch(script, /while\s*\(cursor\s*<\s*remainingTasks\.length\s*&&/,
  'one blocked media pair must not stop checks of other public cards');
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
assert.doesNotMatch(workflow, /^\s+\/index\.json$/m,
  'the hourly audit must not checkout or inspect the non-public root index');
assert.match(reportedWorkflow, /node scripts\/test-verify-ready-preview-live\.mjs/,
  'the PR inventory gate must execute the full-archive regression test');
assert.match(reportedWorkflow, /^\s+\/index\.json$/m,
  'the PR inventory checkout must include the root index');
assert.doesNotMatch(script, /console\.log\([^\n]*(?:entry\.id|entry\.defaultAnimation|previewPath)/,
  'public audit logs must not expose work names or private source paths');

console.log('PASS full-archive audit: every public shard, exact animation pairs, real WebM motion and WebP first-frame decoding');
