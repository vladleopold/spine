// Preserve the source animation order. An explicit selection is immutable;
// when none is specified, the first original animation is the source default.
export function choosePreviewAnimation(names, preferred = '') {
  const available = Array.isArray(names)
    ? names.filter(name => typeof name === 'string' && name.trim())
    : [];
  if (preferred) return preferred;
  return available[0] || '';
}
