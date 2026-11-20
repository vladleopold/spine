import assert from 'node:assert/strict';
import {
  classifyPublishedPreview,
  sourceBlocker,
  validateDecodedVideo,
  validateMediaSignature,
} from './lib/reported-preview-acceptance.mjs';

const ready = {
  skeleton: 'source.skel',
  atlas: 'source.atlas',
  textures: ['page.png'],
  animations: ['Idle'],
  defaultAnimation: 'Idle',
  previewStatus: 'ready',
  webmStatus: 'ready',
  webmPreview: 'https://spine-link.vercel.app/assets/work/preview.webm',
  webpPoster: 'https://spine-link.vercel.app/assets/work/preview.webp',
};

assert.equal(sourceBlocker(ready), '');
assert.equal(sourceBlocker(ready, 'Idle', new Map([
  ['source.skel', 128],
  ['source.atlas', 128],
  ['page.png', 128],
])), '');
assert.equal(sourceBlocker(ready, 'Idle', new Map([
  ['source.skel', 128],
  ['source.atlas', 128],
])), 'missing-source');

const missingAtlas = classifyPublishedPreview({ ...ready, atlas: '' });
assert.deepEqual(missingAtlas, { status: 'blocked', reason: 'missing-source' });

const missingSelection = classifyPublishedPreview({
  ...ready,
  defaultAnimation: '',
  animations: [],
});
assert.deepEqual(missingSelection, {
  status: 'blocked',
  reason: 'missing-animation-selection',
});

const unavailableSelection = classifyPublishedPreview({
  ...ready,
  defaultAnimation: 'Absent',
});
assert.deepEqual(unavailableSelection, {
  status: 'failed',
  reason: 'selected-animation-unavailable',
});

const staleStatus = classifyPublishedPreview({
  ...ready,
  previewStatus: 'failed',
  webmStatus: 'ready',
});
assert.deepEqual(staleStatus, {
  status: 'failed',
  reason: 'preview-not-ready',
});

const missingSelectedPreview = classifyPublishedPreview({
  ...ready,
  allAnimationPreviews: {
    Other: {
      webmPreview: 'https://spine-link.vercel.app/assets/work/other.webm',
      webpPoster: 'https://spine-link.vercel.app/assets/work/other.webp',
    },
  },
});
assert.deepEqual(missingSelectedPreview, {
  status: 'failed',
  reason: 'selected-preview-missing',
});

const pngPoster = classifyPublishedPreview({
  ...ready,
  webpPoster: 'https://spine-link.vercel.app/assets/work/texture.png',
});
assert.deepEqual(pngPoster, {
  status: 'failed',
  reason: 'exact-webm-webp-pair-missing',
});

const mismatchedPair = classifyPublishedPreview({
  ...ready,
  webpPoster: 'https://spine-link.vercel.app/assets/other/preview.webp',
});
assert.deepEqual(mismatchedPair, {
  status: 'failed',
  reason: 'webm-webp-pair-path-mismatch',
});

assert.equal(validateDecodedVideo({ width: 960, height: 540, nb_read_frames: 8 }, 1.5), true);
assert.equal(validateDecodedVideo({ width: 960, height: 540, nb_read_frames: 7 }, 1.5), false);
assert.equal(validateDecodedVideo({ width: 0, height: 540, nb_read_frames: 8 }, 1.5), false);
assert.equal(validateDecodedVideo({ width: 960, height: 540, nb_read_frames: 8 }, 0), false);

const webm = new Uint8Array(256);
webm.set([0x1a, 0x45, 0xdf, 0xa3]);
assert.equal(validateMediaSignature('webm', webm), true);
const webp = new Uint8Array(256);
webp.set([0x52, 0x49, 0x46, 0x46], 0);
webp.set([0x57, 0x45, 0x42, 0x50], 8);
assert.equal(validateMediaSignature('webp', webp), true);
assert.equal(validateMediaSignature('webp', new Uint8Array(32)), false);

console.log('PASS reported-preview status, exact-selection, WebM/WebP, motion and source gates');
