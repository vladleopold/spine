// Pick a visually meaningful animation when an upload doesn't specify one.
// First animations are often pure backgrounds, masks, or transition helpers.
export function choosePreviewAnimation(names, preferred = '') {
  const available = Array.isArray(names)
    ? names.filter(name => typeof name === 'string' && name.trim())
    : [];
  if (preferred && available.includes(preferred)) return preferred;
  const auxiliary = /(?:^|[\s_./-])(?:bkg|bg|background|fg|mask|backup)(?:$|[\s_./-])/i;
  const meaningful = available.filter(name => !auxiliary.test(name));
  const candidates = meaningful.length ? meaningful : available;
  const loop = /(?:^|[\s_./-])(?:idle|loop|walk|run|breathe|breath|attack)(?:$|[\s_./-])/i;
  return candidates.find(name => loop.test(name)) || candidates[0] || '';
}
