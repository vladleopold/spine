import test from 'node:test';
import assert from 'node:assert/strict';
import { buildLibrary01PreviewIndex } from './build-library01-preview-index.mjs';

test('compacts file manifests and preserves the selected animation media links', () => {
  const shards = buildLibrary01PreviewIndex([{
    id: 'Hero_2026',
    previewPath: 'library_01/Hero_2026',
    defaultAnimation: 'idle',
    files: [{ path: 'library_01/Hero_2026/rig/hero.skel', name: 'hero.skel' }],
    sourceProof: { proofPath: 'source-proof.json', proofHash: 'proof', uploader: { browser: 'private' } },
    blockchainAnchor: { anchorPath: 'blockchain-anchor.json', anchorHash: 'anchor', github: { commit: 'private' } },
    allAnimationPreviews: {
      idle: {
        webmPreview: 'https://example.test/assets/library_01/Hero_2026/animations/idle/idle.webm?v=42',
        mp4Preview: 'https://example.test/assets/library_01/Hero_2026/animations/idle/idle.mp4',
        webpPoster: 'https://example.test/assets/library_01/Hero_2026/preview.webp',
        qualityWidths: { high: 960 },
        internalDebug: 'drop-me',
      },
      run: { webmPreview: 'https://example.test/assets/library_01/Hero_2026/animations/run/run.webm' },
    },
  }]);
  const entry = shards.get('h')[0];
  assert.equal(entry.showOwnerLibrary, false);
  assert.deepEqual(entry.files, ['library_01/Hero_2026/rig/hero.skel']);
  assert.deepEqual(entry.sourceProof, { proofPath: 'source-proof.json', proofHash: 'proof' });
  assert.deepEqual(entry.blockchainAnchor, { anchorPath: 'blockchain-anchor.json', anchorHash: 'anchor' });
  assert.equal(entry.allAnimationPreviews.idle.webmPreview, 'idle/idle.webm?v=42');
  assert.equal(entry.allAnimationPreviews.idle.mp4Preview, 'idle/idle.mp4');
  assert.equal(entry.allAnimationPreviews.idle.webpPoster, 'preview.webp');
  assert.equal(entry.allAnimationPreviews.idle.qualityWidths.high, 960);
  assert.equal(entry.allAnimationPreviews.run, undefined);
});

test('splits records into first-character shards', () => {
  const shards = buildLibrary01PreviewIndex([{ id: 'A1' }, { id: 'b2' }]);
  assert.deepEqual([...shards.keys()].sort(), ['a', 'b']);
});
