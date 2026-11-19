// Preserve only the animation explicitly selected by the caller or stored as the work default.
// An absent or invalid selection is a blocked preview, never a reason to choose another timeline.
export function choosePreviewAnimation(_names, preferred = '') {
  return typeof preferred === 'string' && preferred.length > 0 ? preferred : '';
}
