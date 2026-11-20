export const REQUIRED_FULL_EXPORT_KEYS = Object.freeze(
  ['webmPreview', 'mp4Preview', 'movAlpha', 'gifAlpha', 'pngAlpha']
    .flatMap((key) => ['', 'Medium', 'Low'].map((suffix) => key + suffix)),
);

export function buildAnimationIndexMatrix(entry) {
  const hasSkeleton = /\.(json|skel)$/i.test(String(entry?.skeleton || ''));
  const hasAtlas = /\.atlas(?:\.txt)?$/i.test(String(entry?.atlas || ''));
  const hasTextures = Array.isArray(entry?.textures) &&
    entry.textures.some((file) => /\.(png|jpe?g|webp)$/i.test(String(file)));
  const hasAnimations = Array.isArray(entry?.animations) && entry.animations.length > 0;

  if (!entry || !hasSkeleton || !hasAtlas || !hasTextures || !hasAnimations) {
    return { matrix: [], hasItems: false, reason: 'missing-spine-assets-or-animations' };
  }

  // GitHub may suppress job outputs containing a secret-like animation name.
  // Keep the matrix numeric and resolve each exact name inside its worker.
  return {
    matrix: entry.animations.map((_, index) => index),
    hasItems: true,
  };
}

export function resolveAnimationIndex(entry, indexValue) {
  const index = typeof indexValue === 'number' ? indexValue : Number(indexValue);
  const animations = Array.isArray(entry?.animations) ? entry.animations : [];
  if (!Number.isSafeInteger(index) || index < 0 || index >= animations.length) {
    return { status: 'blocked', reason: 'animation-index-unavailable' };
  }

  const animation = animations[index];
  if (typeof animation !== 'string' || animation.length === 0) {
    return { status: 'blocked', reason: 'animation-index-unavailable' };
  }

  return {
    status: 'ready',
    index,
    animation,
    safeName: `animation-${index}`,
  };
}

export function mergeFullExportMetadata(entry, previews, generatedAt) {
  const allAnimationPreviews = previews && typeof previews === 'object' ? previews : {};
  const animations = Array.isArray(entry?.animations) ? entry.animations : [];
  const hasExports = animations.length > 0 && animations.every((name) =>
    REQUIRED_FULL_EXPORT_KEYS.every((key) =>
      typeof allAnimationPreviews[name]?.[key] === 'string' &&
      allAnimationPreviews[name][key].length > 0,
    ),
  );

  // Only the exact indexed/default animation can supply the work-level duration.
  // Never replace defaultAnimation because another track has a longer preview.
  const chosenAnimation = typeof entry?.defaultAnimation === 'string'
    ? entry.defaultAnimation
    : '';
  const selectedPreview = chosenAnimation ? allAnimationPreviews[chosenAnimation] : null;
  const selectedDuration = Number(selectedPreview?.previewDuration);

  const next = {
    ...entry,
    allAnimationPreviews,
    fullExportStatus: hasExports ? 'ready' : 'partial',
    fullExportGeneratedAt: generatedAt,
  };

  if (Number.isFinite(selectedDuration) && selectedDuration > 0) {
    next.previewDuration = selectedDuration;
  } else {
    delete next.previewDuration;
  }

  return next;
}
