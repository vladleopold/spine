// Select configuration keys supported by the exact Spine Web Player API generation.
// Spine 4.0–4.2 expose jsonUrl/binaryUrl + atlasUrl; 4.3 introduced skeleton/atlas.
export function spinePlayerConfigKeys({ isLegacy, modernRuntime, skeletonIsJson }) {
  if (isLegacy) {
    return { skeletonKey: skeletonIsJson ? 'jsonUrl' : 'skelUrl', atlasKey: 'atlasUrl' };
  }
  if (modernRuntime === '4.3') {
    return { skeletonKey: 'skeleton', atlasKey: 'atlas' };
  }
  return { skeletonKey: skeletonIsJson ? 'jsonUrl' : 'binaryUrl', atlasKey: 'atlasUrl' };
}
