import test from 'node:test';
import assert from 'node:assert/strict';
import { animationAssetPath } from './repair-archive-card-previews.mjs';

const entry = { id: 'sp_hyjingx_data-2026-10-03T14-25-07-486Z' };
const previewPath = 'library_01/' + entry.id;
const animation = 'idle1';

test('maps legacy shard URL to the current library shard without changing the animation path', () => {
  const url = 'https://spine-link.vercel.app/assets/library/' + entry.id +
    '/animations/idle1/' + entry.id + '-anim-idle1-preview-medium.webm';
  assert.equal(
    animationAssetPath(url, entry, previewPath, animation, 'medium'),
    previewPath + '/animations/idle1/' + entry.id + '-anim-idle1-preview-medium.webm',
  );
});

test('accepts the current shard path and both supported filename styles', () => {
  const legacy = 'https://spine-link.vercel.app/assets/' + previewPath +
    '/animations/idle1/' + entry.id + '-anim-idle1-preview-low.webm';
  const modern = 'https://spine-link.vercel.app/assets/' + previewPath +
    '/animations/idle1/preview-medium.webm';
  assert.ok(animationAssetPath(legacy, entry, previewPath, animation, 'low'));
  assert.ok(animationAssetPath(modern, entry, previewPath, animation, 'medium'));
});

test('rejects cross-work, cross-animation, wrong-quality and non-site media URLs', () => {
  const wrongWork = 'https://spine-link.vercel.app/assets/library/other-work/animations/idle1/other-work-anim-idle1-preview-medium.webm';
  const wrongAnimation = 'https://spine-link.vercel.app/assets/library/' + entry.id +
    '/animations/walk/' + entry.id + '-anim-walk-preview-medium.webm';
  const wrongTier = 'https://spine-link.vercel.app/assets/library/' + entry.id +
    '/animations/idle1/' + entry.id + '-anim-idle1-preview-low.webm';
  const external = 'https://example.com/assets/library/' + entry.id +
    '/animations/idle1/' + entry.id + '-anim-idle1-preview-medium.webm';
  assert.equal(animationAssetPath(wrongWork, entry, previewPath, animation, 'medium'), '');
  assert.equal(animationAssetPath(wrongAnimation, entry, previewPath, animation, 'medium'), '');
  assert.equal(animationAssetPath(wrongTier, entry, previewPath, animation, 'medium'), '');
  assert.equal(animationAssetPath(external, entry, previewPath, animation, 'medium'), '');
});
