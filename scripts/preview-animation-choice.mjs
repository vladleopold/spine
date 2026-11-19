// Resolve only an explicitly requested or index-declared Spine animation.
// An absent selection is blocked; runtime names are never used to guess a track.
export function choosePreviewAnimation(_names, preferred = '') {
  return typeof preferred === 'string' && preferred.length > 0 ? preferred : '';
}
