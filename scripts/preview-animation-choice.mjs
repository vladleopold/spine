// Preserve an explicit animation name verbatim. An empty selection stays empty,
// even when source tracks exist; callers must block it instead of inferring a track.
export function choosePreviewAnimation(_names, preferred = '') {
  return typeof preferred === 'string' ? preferred : '';
}
