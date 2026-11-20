import assert from 'node:assert/strict';
import { selectExactPreviewTarget } from '../lib/spine-preview-selection.mjs';

const entry = {
  defaultAnimation: 'idle',
  animations: ['idle', 'run'],
  webmPreview: '/default-idle.webm',
  webmPreviewLow: '/default-idle-low.webm',
  thumbnailPoster: '/default-idle.webp',
  previewDuration: 0.1,
  allAnimationPreviews: {
    idle: { webmPreview: '/idle.webm', webpPoster: '/idle.webp', previewDuration: 0.1 },
    run: { webmPreview: '/run.webm', webmPreviewLow: '/run-low.webm', webpPoster: '/run.webp', previewDuration: 4 },
  },
};

assert.deepEqual(selectExactPreviewTarget(entry), {
  name: 'idle', url: '/idle.webm', lowUrl: '/default-idle-low.webm',
  poster: '/idle.webp', duration: 0.1, isFallback: false,
}, 'a short selected default must not be replaced by a longer run animation');

assert.equal(selectExactPreviewTarget(entry, 'run').name, 'run');
assert.equal(selectExactPreviewTarget(entry, 'run').url, '/run.webm');
assert.equal(selectExactPreviewTarget(entry, 'run').poster, '/run.webp');

assert.deepEqual(selectExactPreviewTarget(entry, 'missing'), {
  name: 'missing', url: '', lowUrl: '', poster: '', duration: 0, isFallback: false,
}, 'an unavailable requested name is preserved and receives no default media');

assert.deepEqual(selectExactPreviewTarget({ animations: ['idle', 'run'], allAnimationPreviews: entry.allAnimationPreviews }), {
  name: '', url: '', lowUrl: '', poster: '', duration: 0, isFallback: false,
}, 'an animation list alone must not select a preview');

assert.deepEqual(selectExactPreviewTarget({
  defaultAnimation: 'idle',
  webmPreview: '/idle-root.webm',
  thumbnailPoster: '/idle-root.webp',
  allAnimationPreviews: {},
}, 'run'), {
  name: 'run', url: '', lowUrl: '', poster: '', duration: 0, isFallback: false,
}, 'root default media must never be reused for another selected animation');

assert.deepEqual(selectExactPreviewTarget({
  defaultAnimation: 'not-in-list',
  animations: ['idle', 'run'],
  allAnimationPreviews: {},
}), {
  name: 'not-in-list', url: '', lowUrl: '', poster: '', duration: 0, isFallback: false,
}, 'an explicit default is preserved even when absent from the source list');

console.log('Exact Spine preview selection tests passed');
