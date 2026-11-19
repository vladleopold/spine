// Spine Player config keys differ by runtime generation and skeleton format.
// Binary .skel sources must never be passed through the JSON-only "skeleton" key.
export function skeletonPlayerKeyFor({ isLegacy = false, oldPlayerConfig = false, skeletonFile = '' } = {}) {
  const binary = String(skeletonFile).toLowerCase().endsWith('.skel');
  if (isLegacy) return binary ? 'skelUrl' : 'jsonUrl';
  if (oldPlayerConfig) return binary ? 'binaryUrl' : 'jsonUrl';
  return binary ? 'skelUrl' : 'skeleton';
}

export function atlasPlayerKeyFor({ oldPlayerConfig = false } = {}) {
  return oldPlayerConfig ? 'atlasUrl' : 'atlas';
}
