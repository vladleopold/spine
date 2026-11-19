// Preserve an explicit/indexed animation verbatim. With no selected/default
// name, block the preview instead of guessing the first runtime track.
export function choosePreviewAnimation(_names, preferred = '') {
  return typeof preferred === 'string' ? preferred : '';
}
