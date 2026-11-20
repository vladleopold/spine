// Resolve one exact requested/default animation. Never inspect the animation list
// to choose a substitute; the renderer owns availability validation.
import { writeFileSync } from 'node:fs';
export function resolveRenderSelection(config = {}, entry = {}) {
  const requested = typeof config?.animation === 'string' ? config.animation : '';
  const indexed = typeof entry?.defaultAnimation === 'string' ? entry.defaultAnimation : '';
  const animation = requested.trim() ? requested : indexed;
  if (!animation.trim()) {
    return { status: 'blocked', code: 'NO_DEFAULT_SPINE_ANIMATION', animation: '' };
  }
  return { status: 'selected', code: null, animation };
}

// Preview-only recovery must not fan out into a full export of other animations.
export function shouldDispatchFullExport(config = {}) {
  return config?.previewOnly !== true;
}

export function writeRenderVerification(path, report) {
  writeFileSync(path, JSON.stringify(report, null, 2));
}
