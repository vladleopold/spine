// Browser preview generation is limited to runtimes for which this repository
// ships a matching Spine Web Player bundle. Older skeletons must be re-exported;
// never load a mismatched or nonexistent player runtime and misreport a 404 as
// a network outage.
export function spinePlayerSourceBlocker(version, skeletonFile) {
  const normalizedVersion = String(version || '').trim();
  // Exported skeletons can carry provenance suffixes such as
  // "4.1-from-4.2.43". The leading major/minor still identifies the
  // serialized format and must be parsed before the suffix.
  const versionMatch = normalizedVersion.match(/^(\d+)\.(\d+)(?:[.-]|$)/);
  if (!versionMatch) {
    return {
      code: 'SPINE_VERSION_UNKNOWN',
      message: 'Spine export version could not be detected; the renderer will not guess a player runtime.',
    };
  }

  const major = Number(versionMatch[1]);
  const minor = Number(versionMatch[2]);
  const supportedRuntime =
    (major === 3 && (minor === 7 || minor === 8)) ||
    (major === 4 && minor >= 0 && minor <= 3);
  if (!supportedRuntime) {
    return {
      code: 'UNSUPPORTED_SPINE_WEB_PLAYER_VERSION',
      message: `No bundled Spine Web Player runtime supports Spine ${normalizedVersion}; use a matching supported Spine runtime before browser preview generation.`,
    };
  }
  if (major < 3 || (major === 3 && minor < 7)) {
    return {
      code: 'UNSUPPORTED_SPINE_WEB_PLAYER_VERSION',
      message: `No bundled Spine Web Player runtime supports Spine ${normalizedVersion}; re-export with Spine 3.7+ before browser preview generation.`,
    };
  }

  // Spine Player 3.7 validates jsonUrl only; it has no skelUrl/binaryUrl path.
  // Never pass a binary .skel to that runtime or let the player fail ambiguously.
  const isBinarySkeleton = /\.skel$/i.test(String(skeletonFile || ''));
  if (major === 3 && minor === 7 && isBinarySkeleton) {
    return {
      code: 'UNSUPPORTED_SPINE_3_7_BINARY_SKELETON',
      message: 'Spine Player 3.7 requires jsonUrl; binary .skel cannot be loaded without a same-work JSON skeleton.',
    };
  }
  return null;
}
