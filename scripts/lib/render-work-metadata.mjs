export function buildVerifiedPreviewMetadata({ meta, highWebm, highPoster, origin, workPath, generatedAt }) {
  const frames = Number(highWebm?.nb_read_frames);
  const width = Number(highWebm?.width);
  const height = Number(highWebm?.height);
  const duration = Number(highWebm?.duration);
  if (!Number.isInteger(frames) || frames < 8) throw new Error('PREVIEW_WEBM_FRAME_COUNT_INVALID');
  if (!Number.isInteger(width) || width <= 0 || !Number.isInteger(height) || height <= 0) throw new Error('PREVIEW_WEBM_DIMENSIONS_INVALID');
  if (!Number.isFinite(duration) || duration <= 0) throw new Error('PREVIEW_WEBM_DURATION_INVALID');
  if (String(highPoster?.codec_name || '').toLowerCase() !== 'webp') throw new Error('PREVIEW_WEBP_POSTER_CODEC_INVALID');
  if (Number(highPoster.width) !== width || Number(highPoster.height) !== height) throw new Error('PREVIEW_WEBP_POSTER_DIMENSIONS_INVALID');
  const animation = String(meta?.animation || '').trim();
  if (!animation) throw new Error('PREVIEW_ANIMATION_METADATA_MISSING');
  const cleanOrigin = String(origin).endsWith('/') ? String(origin).slice(0, -1) : String(origin);
  const cleanWorkPath = String(workPath).split('/').filter(Boolean).join('/');
  const base = cleanOrigin + '/assets/' + cleanWorkPath + '/';
  const url = file => base + file;
  return {
    webmStatus: 'ready',
    webmError: null,
    previewStatus: 'ready',
    previewError: '',
    lastPreviewRetryError: '',
    dispatchStatus: 'rendered',
    webmPreview: url('preview.webm'),
    webmPreviewMedium: url('preview-medium.webm'),
    webmPreviewLow: url('preview-low.webm'),
    webmPreviewPath: cleanWorkPath + '/preview.webm',
    webpPoster: url('preview.webp'),
    webpPosterMedium: url('preview-medium.webp'),
    webpPosterLow: url('preview-low.webp'),
    thumbnailPoster: url('preview.webp'),
    previewWidth: width,
    previewHeight: height,
    previewFrameCount: frames,
    previewDuration: duration,
    qualityWidths: meta.qualityWidths || {},
    defaultAnimation: animation,
    animations: Array.isArray(meta.animations) ? meta.animations : [],
    skeleton: meta.skeleton,
    atlas: meta.atlas,
    textures: Array.isArray(meta.textures) ? meta.textures : [],
    webmGeneratedAt: generatedAt,
    posterGeneratedAt: generatedAt,
  };
}
