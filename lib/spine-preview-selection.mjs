export function selectExactPreviewTarget(entry = {}, requestedAnimation = '') {
  const defaultAnimation = String(entry?.defaultAnimation || '').trim();
  const name = String(requestedAnimation || defaultAnimation).trim();
  if (!name) {
    return { name: '', url: '', lowUrl: '', poster: '', duration: 0, isFallback: false };
  }

  const previews = entry?.allAnimationPreviews && typeof entry.allAnimationPreviews === 'object'
    ? entry.allAnimationPreviews
    : {};
  const selected = previews[name] && typeof previews[name] === 'object' ? previews[name] : {};
  const isDefault = name === defaultAnimation;
  const clean = (value) => typeof value === 'string' ? value.trim() : '';
  const url = clean(selected.webmPreview) || (isDefault ? clean(entry?.webmPreview) : '');
  const lowUrl = clean(selected.webmPreviewLow) || clean(selected.webmPreviewMedium) ||
    (isDefault ? clean(entry?.webmPreviewLow) || clean(entry?.webmPreviewMedium) || clean(entry?.webmPreview) : '') ||
    url;
  const poster = clean(selected.webpPoster) ||
    (isDefault ? clean(entry?.thumbnailPoster) || clean(entry?.webpPoster) : '');
  const rawDuration = selected.previewDuration ?? (isDefault ? entry?.previewDuration : 0);
  const duration = Number(rawDuration);

  return {
    name,
    url,
    lowUrl,
    poster,
    duration: Number.isFinite(duration) && duration > 0 ? duration : 0,
    isFallback: false,
  };
}
