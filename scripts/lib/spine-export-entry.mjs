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

// Never infer a default from the first available track. Keep the caller's
// exact string, even when the skeleton does not expose it; the renderer will
// report that selection as unavailable instead of substituting another one.
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

// Do not leave an unselected upload in a misleading pending state. Preserve
// source files and any existing media bytes, but make the missing selection explicit.
export function missingAnimationPreviewMetadata(entry) {
  if (resolveSpineExportDispatch(entry).status !== 'blocked') return null;
  return {
    webmStatus: 'blocked-missing-animation-selection',
    previewStatus: 'blocked',
    previewError: 'No explicit default animation is selected; existing media cannot be attributed to an exact source animation',
    dispatchStatus: 'blocked',
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
  if (!requestedDefault.trim()) {
    return { entry: null, error: 'DEFAULT_ANIMATION_REQUIRED' };
  }

  // Do not trim, infer, deduplicate, or insert animation names into source
  // metadata. A stale/unavailable name must remain exact and fail closed.
  return {
    entry: { ...entry, defaultAnimation: requestedDefault },
    error: null,
  };
}
