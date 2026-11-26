// Preserve exact user/index selections. The special auto-discovery sentinel
// is a command, not an animation name: salvage must use the actual track
// reported by the renderer, then (only if absent) the exact indexed default.
export function chooseRecoveryAnimation(explicitAnimation, indexedDefault = '', runtimeSelected = '') {
  const explicit = typeof explicitAnimation === 'string' ? explicitAnimation : '';
  if (explicit && explicit !== '__SPINE_AUTO__') return explicit;
  if (typeof runtimeSelected === 'string' && runtimeSelected) return runtimeSelected;
  if (typeof indexedDefault === 'string' && indexedDefault) return indexedDefault;
  return '';
}
