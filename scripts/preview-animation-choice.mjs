// Preserve an explicit indexed selection exactly. If no selection exists,
// use a deterministic source-track fallback: Idle first, then the first track.
// The renderer still rejects unavailable, invisible, or static tracks; this
// never edits the source skeleton or its defaultAnimation metadata.
export function choosePreviewAnimation(names, preferred = '') {
  if (typeof preferred === 'string' && preferred.length > 0) return preferred;
  const available = Array.isArray(names)
    ? names.filter(name => typeof name === 'string' && name.length > 0)
    : [];
  return available.find(name => /^idle$/i.test(name)) ||
    available.find(name => /idle/i.test(name)) ||
    available[0] ||
    '';
}
