// Preserve an explicit source selection verbatim. Callers may pass an empty
// preferred value only after proving that a selected track is missing/static.
// Without a selection, prefer Idle and otherwise preserve source track order.
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
