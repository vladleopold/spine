const TOP_LEVEL_PREVIEW_FIELDS = [
  'webmPreview',
  'webmPreviewMedium',
  'webmPreviewLow',
  'webmPreviewFull',
  'webpPoster',
  'webpPosterMedium',
  'webpPosterLow',
  'webmPreviewPath',
  'previewWidth',
  'previewHeight',
  'previewDuration',
  'qualityWidths',
  'webmGeneratedAt',
];

export function hasSpineSourceBundle(entry) {
  const skeleton = String(entry?.skeleton || '');
  const atlas = String(entry?.atlas || '');
  const textures = Array.isArray(entry?.textures) ? entry.textures : [];
  const files = Array.isArray(entry?.files) ? entry.files : [];
  const hasSkeleton = /\.(json|skel)$/i.test(skeleton) &&
    files.some((file) => typeof file === 'string' && /\.(json|skel)$/i.test(file));
  const hasAtlas = /\.atlas(?:\.txt)?$/i.test(atlas) &&
    files.some((file) => typeof file === 'string' && /\.atlas(?:\.txt)?$/i.test(file));
  const hasTexture = textures.some((file) => /\.(png|jpe?g|webp)$/i.test(String(file))) &&
    files.some((file) => typeof file === 'string' && /\.(png|jpe?g|webp)$/i.test(file));
  return hasSkeleton && hasAtlas && hasTexture;
}

// Dispatch only an explicitly selected animation. The exact string is passed
// through even if the skeleton's advertised animation list does not contain it;
// the renderer must fail that same selection rather than choose another track.
export function resolveSpineExportDispatch(entry) {
  const animation = typeof entry?.defaultAnimation === 'string'
    ? entry.defaultAnimation
    : '';
  if (!animation.trim()) {
    return { status: 'blocked', reason: 'missing-default-animation' };
  }
  return {
    status: 'ready',
    animation,
    animations: Array.isArray(entry?.animations) ? entry.animations : [],
  };
}

export function missingAnimationPreviewMetadata(entry) {
  if (!hasSpineSourceBundle(entry) || resolveSpineExportDispatch(entry).status !== 'blocked') return null;
  return {
    webmStatus: 'blocked-missing-animation-selection',
    previewStatus: 'blocked',
    dispatchStatus: 'blocked',
    webmError: 'missing-default-animation',
    previewError: 'missing-default-animation',
  };
}

export function shouldPreserveAcceptedPreview(existingEntry, nextEntry) {
  if (!hasSpineSourceBundle(nextEntry) || existingEntry?.webmStatus !== 'ready') return false;
  const previewStatus = typeof existingEntry.previewStatus === 'string'
    ? existingEntry.previewStatus
    : '';
  if (previewStatus && previewStatus !== 'ready') return false;
  if (resolveSpineExportDispatch(nextEntry).status !== 'ready') return false;
  if (existingEntry.defaultAnimation !== nextEntry.defaultAnimation) return false;
  for (const key of ['previewPath', 'skeleton', 'atlas']) {
    if (String(existingEntry[key] || '') !== String(nextEntry[key] || '')) return false;
  }
  const oldTextures = JSON.stringify(Array.isArray(existingEntry.textures) ? existingEntry.textures : []);
  const newTextures = JSON.stringify(Array.isArray(nextEntry.textures) ? nextEntry.textures : []);
  return oldTextures === newTextures;
}

// Merge upload metadata without carrying a ready top-level preview across a
// changed source or animation selection. Per-animation records remain intact;
// only the selected work-level media is invalidated.
export function mergeSpineExportPreviewState(entry, existingEntry = null) {
  if (!hasSpineSourceBundle(entry)) {
    const next = { ...(existingEntry || {}), ...entry };
    if (existingEntry?.webmStatus === 'ready') next.webmStatus = 'ready';
    else if (!next.webmStatus) next.webmStatus = 'skipped';
    return {
      entry: next,
      preserveAcceptedPreview: existingEntry?.webmStatus === 'ready',
      shouldDispatch: false,
    };
  }

  const next = { ...entry };
  const allAnimationPreviews = {
    ...(existingEntry?.allAnimationPreviews && typeof existingEntry.allAnimationPreviews === 'object'
      ? existingEntry.allAnimationPreviews
      : {}),
    ...(entry?.allAnimationPreviews && typeof entry.allAnimationPreviews === 'object'
      ? entry.allAnimationPreviews
      : {}),
  };
  if (Object.keys(allAnimationPreviews).length) next.allAnimationPreviews = allAnimationPreviews;

  const preserve = shouldPreserveAcceptedPreview(existingEntry, entry);
  if (preserve) {
    for (const key of TOP_LEVEL_PREVIEW_FIELDS) {
      if ((next[key] === undefined || next[key] === null || next[key] === '') &&
          existingEntry[key] !== undefined) {
        next[key] = existingEntry[key];
      }
    }
  } else {
    for (const key of TOP_LEVEL_PREVIEW_FIELDS) delete next[key];
  }

  const blocked = missingAnimationPreviewMetadata(entry);
  if (blocked) {
    Object.assign(next, blocked);
  } else if (preserve) {
    Object.assign(next, {
      webmStatus: 'ready',
      previewStatus: existingEntry.previewStatus || 'ready',
      dispatchStatus: existingEntry.dispatchStatus || 'ready',
      webmError: null,
      previewError: null,
    });
  } else if (hasSpineSourceBundle(entry)) {
    Object.assign(next, {
      webmStatus: 'pending',
      previewStatus: 'pending',
      dispatchStatus: 'pending',
      webmError: null,
      previewError: null,
    });
  } else {
    next.webmStatus = 'skipped';
  }

  return {
    entry: next,
    preserveAcceptedPreview: preserve,
    shouldDispatch: hasSpineSourceBundle(entry) && !blocked && !preserve,
  };
}

export function normalizeSpineExportEntry(entry) {
  if (!hasSpineSourceBundle(entry)) return { entry, error: null };

  if (entry?.defaultAnimation != null && typeof entry.defaultAnimation !== 'string') {
    return { entry: null, error: 'DEFAULT_ANIMATION_INVALID' };
  }
  const requestedDefault = typeof entry?.defaultAnimation === 'string'
    ? entry.defaultAnimation
    : '';
  if (requestedDefault.length > 200) {
    return { entry: null, error: 'DEFAULT_ANIMATION_INVALID' };
  }

  // Do not infer, trim, deduplicate, or insert animation names into source
  // metadata. Missing selection is persisted as blocked by the upload handler.
  return { entry: { ...entry }, error: null };
}
