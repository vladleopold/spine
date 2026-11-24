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

/**
 * Resolve the animation requested for a preview render. Explicit source
 * selections remain exact unless the recovery pipeline explicitly opts into
 * visible-track fallback; in that case a missing/stale selection falls back
 * to a real source animation instead of aborting the render.
 */
export function resolvePreviewAnimation(names, preferred = '', allowFallback = false) {
  const available = Array.isArray(names) ? names.filter(name => typeof name === 'string' && name.trim()) : [];
  const requested = typeof preferred === 'string' ? preferred : '';
  if (!requested) return choosePreviewAnimation(available, '');
  if (available.includes(requested)) return requested;
  return allowFallback ? choosePreviewAnimation(available, '') : requested;
}
