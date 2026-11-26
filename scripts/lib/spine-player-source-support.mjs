// Browser preview generation is limited to runtimes for which this repository
// ships a matching Spine Web Player bundle. Older skeletons must be re-exported;
// never load a mismatched or nonexistent player runtime and misreport a 404 as
// a network outage.

/**
 * Spine 3.7 binary skeletons are readable by the bundled 3.8 player.
 * Keep JSON exports on their native 3.7 path; only binary .skel gets the
 * compatibility override.
 */
export function runtimeVersionOverrideForSpineSkeleton(version, skeletonFile) {
  const normalizedVersion = String(version || '').trim();
  if (/^3\.7(?:\.|$)/.test(normalizedVersion) && /\.skel$/i.test(String(skeletonFile || ''))) {
    return '3.8';
  }
  return '';
}

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

  // Spine 3.7's player accepts JSON only. Binary 3.7 is routed to the
  // compatible bundled 3.8 player by runtimeVersionOverrideForSpineSkeleton.
  const isBinarySkeleton = /\.skel$/i.test(String(skeletonFile || ''));
  if (major === 3 && minor === 7 && isBinarySkeleton &&
      !runtimeVersionOverrideForSpineSkeleton(normalizedVersion, skeletonFile)) {
    return {
      code: 'UNSUPPORTED_SPINE_3_7_BINARY_SKELETON',
      message: 'Spine 3.7 binary .skel requires the compatible bundled 3.8 player.',
    };
  }
  return null;
}


// Return only the minor component expected by the legacy vendor asset paths.
// Binary Spine 3.7 is parsed by the compatible 3.8 runtime; returning the
// full override ("3.8") here would construct the invalid 3.3.8 asset URL.
export function runtimeMinorForSpineSkeleton(version, skeletonFile) {
  const override = runtimeVersionOverrideForSpineSkeleton(version, skeletonFile);
  const selected = override || String(version || '').trim();
  const match = selected.match(/^\\d+\\.(\\d+)(?:[.-]|$)/);
  return match ? match[1] : '8';
}
