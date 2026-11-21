// Resolve only an explicitly selected/indexed animation. Never infer a default
// from declaration order, visibility, duration, or a different preview record.
export function selectExactAnimation(names, preferred) {
  const name = typeof preferred === 'string' ? preferred : '';
  if (!name) {
    return { status: 'blocked', name, animation: null, reason: 'missing-explicit-selection' };
  }
  const animation = Array.isArray(names)
    ? names.find((item) => (typeof item === 'string' ? item : item?.name) === name) || null
    : null;
  if (!animation) {
    return { status: 'blocked', name, animation: null, reason: 'selected-animation-unavailable' };
  }
  return { status: 'ready', name, animation, reason: '' };
}

export function selectExactPreview(entry, preferred) {
  const name = typeof preferred === 'string'
    ? preferred
    : (typeof entry?.defaultAnimation === 'string' ? entry.defaultAnimation : '');
  const previews = entry?.allAnimationPreviews && typeof entry.allAnimationPreviews === 'object'
    ? entry.allAnimationPreviews
    : null;
  const preview = name && previews && !Array.isArray(previews) ? previews[name] : null;
  if (!preview || typeof preview !== 'object' || Array.isArray(preview)) {
    return { status: 'blocked', name, preview: null, reason: name ? 'selected-preview-unavailable' : 'missing-explicit-selection' };
  }
  return { status: 'ready', name, preview, reason: '' };
}
