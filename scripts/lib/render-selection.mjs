// Resolve one exact requested/default animation. Never inspect the animation list
// to choose a substitute; the renderer owns availability validation.
export function resolveRenderSelection(config = {}, entry = {}) {
  const requested = typeof config?.animation === 'string' ? config.animation : '';
  const indexed = typeof entry?.defaultAnimation === 'string' ? entry.defaultAnimation : '';
  const animation = requested.trim() ? requested : indexed;
  if (!animation.trim()) {
    return { status: 'blocked', code: 'NO_DEFAULT_SPINE_ANIMATION', animation: '' };
  }
  return { status: 'selected', code: null, animation };
}
