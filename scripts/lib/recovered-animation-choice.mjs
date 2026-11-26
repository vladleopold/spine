// Preserve exact explicit source selections. __SPINE_AUTO__ is a command,
// not a track name: salvage must use the exact track reported by the renderer,
// then (only if absent) the exact indexed default. Never choose by list order.
export function chooseRecoveryAnimation(explicitAnimation, indexedDefault = '', runtimeSelected = '') {
  const explicit = typeof explicitAnimation === 'string' ? explicitAnimation : '';
  if (explicit && explicit !== '__SPINE_AUTO__') return explicit;
  if (typeof runtimeSelected === 'string' && runtimeSelected) return runtimeSelected;
  if (typeof indexedDefault === 'string' && indexedDefault) return indexedDefault;
  return '';
}
