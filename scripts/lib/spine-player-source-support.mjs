// Spine Player 3.7 validates jsonUrl only; it has no skelUrl/binaryUrl path.
// Never pass a binary .skel to that runtime or let the player fail ambiguously.
export function spinePlayerSourceBlocker(version, skeletonFile) {
  const normalizedVersion = String(version || '').trim();
  const isBinarySkeleton = /\.skel$/i.test(String(skeletonFile || ''));
  if (/^3\.7(?:\.|$)/.test(normalizedVersion) && isBinarySkeleton) {
    return {
      code: 'UNSUPPORTED_SPINE_3_7_BINARY_SKELETON',
      message: 'Spine Player 3.7 requires jsonUrl; binary .skel cannot be loaded without a same-work JSON skeleton.',
    };
  }
  return null;
}
