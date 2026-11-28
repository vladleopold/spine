import assert from 'node:assert/strict';
import { acceptPreviewRender } from './lib/preview-ready-state.mjs';

const stale = {
  id: 'work-1',
  defaultAnimation: 'idle',
  webmStatus: 'blocked-incomplete-source',
  previewStatus: 'blocked',
  webmError: 'old renderer failure',
  previewError: 'old atlas error',
  previewBlockedAt: '2026-11-28T10:00:00.000Z',
  previewBlockedAnimation: 'idle',
  previewBlockedSourceFingerprint: 'old-source',
  previewBlockedSkin: 'default',
  previewBlockedDistinctError: 'ATLAS_REGION_MISSING',
  previewBlockedRendererRevision: 'old-renderer',
  lastPreviewRetryError: 'old retry error',
};

const media = {
  webmPreview: 'https://spine-link.vercel.app/assets/library_02/work-1/preview.webm',
  webpPoster: 'https://spine-link.vercel.app/assets/library_02/work-1/preview.webp',
  previewAnimation: 'idle',
};
const accepted = acceptPreviewRender(stale, media, '2026-11-28T18:00:00.000Z');

assert.equal(accepted.webmStatus, 'ready');
assert.equal(accepted.previewStatus, 'ready',
  'a successful render must clear a stale blocked preview state so the archive can expose its WebM');
assert.equal(accepted.webmError, null);
assert.equal(accepted.previewError, '');
assert.equal(accepted.dispatchStatus, 'rendered');
assert.equal(accepted.previewUpdatedAt, '2026-11-28T18:00:00.000Z');
assert.equal(accepted.defaultAnimation, 'idle',
  'accepting preview media must not rewrite the source default animation');
assert.equal(accepted.previewAnimation, 'idle');
for (const key of [
  'previewBlockedAt',
  'previewBlockedAnimation',
  'previewBlockedSourceFingerprint',
  'previewBlockedSkin',
  'previewBlockedDistinctError',
  'previewBlockedRendererRevision',
  'lastPreviewRetryError',
]) {
  assert.equal(Object.hasOwn(accepted, key), false, key + ' must be cleared after successful publication');
}
assert.equal(stale.previewStatus, 'blocked',
  'accepting a preview must not mutate the caller\'s source record');

console.log('PASS successful preview publication clears stale blocked state without mutating source metadata');
