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

export function normalizeSpineExportEntry(entry) {
  if (!hasSpineSourceBundle(entry)) return { entry, error: null };

  const animations = Array.isArray(entry?.animations)
    ? [...new Set(entry.animations
        .map((name) => String(name || '').trim())
        .filter((name) => name && name.length <= 200))]
    : [];
  const requestedDefault = String(entry?.defaultAnimation || '').trim();
  if (requestedDefault.length > 200) {
    return { entry: null, error: 'DEFAULT_ANIMATION_INVALID' };
  }

  const defaultAnimation = requestedDefault || animations[0] || '';
  if (!defaultAnimation) {
    return { entry: null, error: 'DEFAULT_ANIMATION_REQUIRED' };
  }
  if (!animations.includes(defaultAnimation)) animations.unshift(defaultAnimation);

  return {
    entry: { ...entry, animations, defaultAnimation },
    error: null,
  };
}
