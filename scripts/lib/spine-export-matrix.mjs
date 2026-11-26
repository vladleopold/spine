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
  const validIndexValue = typeof indexValue === 'number'
    ? Number.isSafeInteger(indexValue)
    : typeof indexValue === 'string' && /^(?:0|[1-9]\d*)$/.test(indexValue);
  const index = typeof indexValue === 'number' ? indexValue : Number(indexValue);
  const animations = Array.isArray(entry?.animations) ? entry.animations : [];
  if (!validIndexValue || index < 0 || index >= animations.length) {
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

function firstString(...values) {
  return values.find((value) => typeof value === 'string' && value.length > 0) || '';
}

function selectPlayablePreviewAnimation(entry, allAnimationPreviews) {
  const animations = Array.isArray(entry?.animations)
    ? entry.animations
    : Object.keys(allAnimationPreviews);
  const candidates = [
    entry?.previewAnimation,
    entry?.defaultAnimation,
    ...animations,
  ].filter((name, index, list) =>
    typeof name === 'string' && name.length > 0 && list.indexOf(name) === index,
  );

  for (const animation of candidates) {
    const preview = allAnimationPreviews[animation];
    const duration = Number(preview?.previewDuration);
    const webm = firstString(
      preview?.webmPreview,
      preview?.webmPreviewMedium,
      preview?.webmPreviewLow,
    );
    if (webm && Number.isFinite(duration) && duration >= 2) {
      return { animation, preview, duration };
    }
  }
  return null;
}

export function mergeFullExportMetadata(entry, previews, generatedAt) {
  const allAnimationPreviews = {
    ...(entry?.allAnimationPreviews && typeof entry.allAnimationPreviews === 'object'
      ? entry.allAnimationPreviews
      : {}),
    ...(previews && typeof previews === 'object' ? previews : {}),
  };
  const animations = Array.isArray(entry?.animations) ? entry.animations : [];
  const hasExports = animations.length > 0 && animations.every((name) =>
    REQUIRED_FULL_EXPORT_KEYS.every((key) =>
      typeof allAnimationPreviews[name]?.[key] === 'string' &&
      allAnimationPreviews[name][key].length > 0,
    ),
  );

  // Keep the interactive Spine Player's defaultAnimation untouched. The
  // work-level video preview is a separate selection and must be long enough
  // to produce a useful playable clip; prefer an existing valid preview,
  // then the player default, then source animation order.
  const playable = selectPlayablePreviewAnimation(entry, allAnimationPreviews);
  const next = {
    ...entry,
    allAnimationPreviews,
    fullExportStatus: hasExports ? 'ready' : 'partial',
    fullExportGeneratedAt: generatedAt,
  };

  if (playable) {
    next.previewAnimation = playable.animation;
    next.previewDuration = playable.duration;
    for (const key of REQUIRED_FULL_EXPORT_KEYS) {
      if (typeof playable.preview[key] === 'string' && playable.preview[key].length > 0) {
        next[key] = playable.preview[key];
      }
    }
    for (const key of ['webpPoster', 'webpPosterMedium', 'webpPosterLow']) {
      if (typeof playable.preview[key] === 'string' && playable.preview[key].length > 0) {
        next[key] = playable.preview[key];
      }
    }
    if (playable.preview.qualityWidths && typeof playable.preview.qualityWidths === 'object') {
      next.qualityWidths = playable.preview.qualityWidths;
    }
  } else {
    delete next.previewAnimation;
    const defaultPreview = typeof entry?.defaultAnimation === 'string'
      ? allAnimationPreviews[entry.defaultAnimation]
      : null;
    const defaultDuration = Number(defaultPreview?.previewDuration);
    if (Number.isFinite(defaultDuration) && defaultDuration > 0) {
      next.previewDuration = defaultDuration;
    } else {
      delete next.previewDuration;
    }
  }

  return next;
}
