import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { buildVerifiedPreviewMetadata } from './lib/render-work-metadata.mjs';

const meta = {
  animation: 'Exact Selected Animation',
  animations: ['Exact Selected Animation', 'Other Track'],
  qualityWidths: { high: 960, medium: 634, low: 316 },
  skeleton: 'source.skel',
  atlas: 'source.atlas',
  textures: ['source.png'],
};
const highWebm = { width: 960, height: 720, nb_read_frames: '60', duration: 2 };
const highPoster = { codec_name: 'webp', width: 960, height: 720, nb_read_frames: '1' };

test('verified poster and WebM set ready metadata and clear stale failure state', () => {
  const result = buildVerifiedPreviewMetadata({
    meta, highWebm, highPoster, origin: 'https://spine-link.vercel.app',
    workPath: 'library_02/public-work', generatedAt: '2026-11-20T18:00:00.000Z',
  });
  assert.equal(result.previewStatus, 'ready');
  assert.equal(result.webmStatus, 'ready');
  assert.equal(result.previewError, '');
  assert.equal(result.lastPreviewRetryError, '');
  assert.equal(result.webmError, null);
  assert.equal(result.dispatchStatus, 'rendered');
  assert.equal(result.previewFrameCount, 60);
  assert.equal(result.previewDuration, 2);
  assert.equal(result.previewWidth, 960);
  assert.equal(result.previewHeight, 720);
  assert.equal(result.defaultAnimation, 'Exact Selected Animation');
  assert.equal(result.thumbnailPoster, result.webpPoster);
  assert.equal(result.webpPoster, 'https://spine-link.vercel.app/assets/library_02/public-work/preview.webp');
  assert.equal(result.webmPreview, 'https://spine-link.vercel.app/assets/library_02/public-work/preview.webm');
  assert.equal(result.posterGeneratedAt, '2026-11-20T18:00:00.000Z');
});

test('rejects a poster or WebM that is not genuinely decodable and dimension-matched', () => {
  assert.throws(() => buildVerifiedPreviewMetadata({ meta, highWebm: { ...highWebm, nb_read_frames: '7' }, highPoster, origin: 'https://spine-link.vercel.app', workPath: 'x', generatedAt: 'now' }), /PREVIEW_WEBM_FRAME_COUNT_INVALID/);
  assert.throws(() => buildVerifiedPreviewMetadata({ meta, highWebm, highPoster: { ...highPoster, codec_name: 'png' }, origin: 'https://spine-link.vercel.app', workPath: 'x', generatedAt: 'now' }), /PREVIEW_WEBP_POSTER_CODEC_INVALID/);
  assert.throws(() => buildVerifiedPreviewMetadata({ meta, highWebm, highPoster: { ...highPoster, width: 320 }, origin: 'https://spine-link.vercel.app', workPath: 'x', generatedAt: 'now' }), /PREVIEW_WEBP_POSTER_DIMENSIONS_INVALID/);
  assert.throws(() => buildVerifiedPreviewMetadata({ meta: { ...meta, animation: '' }, highWebm, highPoster, origin: 'https://spine-link.vercel.app', workPath: 'x', generatedAt: 'now' }), /PREVIEW_ANIMATION_METADATA_MISSING/);
});

test('render-work publishes the metadata produced by the verification helper', () => {
  const source = fs.readFileSync(new URL('../render-work.mjs', import.meta.url), 'utf8');
  assert.ok(source.includes('buildVerifiedPreviewMetadata'));
  assert.ok(source.includes('highWebmProbe'));
  assert.ok(source.includes('highPosterProbe'));
});
