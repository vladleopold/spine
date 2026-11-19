// Pick a visually meaningful animation when an upload doesn't specify one.
// First animations are often pure backgrounds, masks, or transition helpers.
export function choosePreviewAnimation(names, preferred = '') {
  const available = Array.isArray(names)
    ? names.filter(name => typeof name === 'string' && name.trim())
    : [];
  // A caller-supplied name is immutable. If absent from the skeleton the
  // renderer must fail, never silently switch to another timeline.
  if (preferred) return preferred;
  const auxiliary = /(?:^|[\s_./-])(?:bkg|bg|background|fg|mask|backup)(?:$|[\s_./-])/i;
  const meaningful = available.filter(name => !auxiliary.test(name));
  // Do not turn a skeleton containing only masks/backgrounds into a preview.
  // With no meaningful default animation, fail closed instead of guessing.
  if (!meaningful.length) return '';
  const loop = /(?:^|[\s_./-])(?:idle|loop|walk|run|breathe|breath|attack)(?:$|[\s_./-])/i;
  return meaningful.find(name => loop.test(name)) || meaningful[0] || '';
}
