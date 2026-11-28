function atlasRegionNames(atlasText) {
  const lines = String(atlasText).split(/\r?\n/);
  const names = new Set();
  for (let i = 0; i + 1 < lines.length; i++) {
    const name = lines[i].trim();
    if (!name || /^\s/.test(lines[i]) || /\.(?:png|jpe?g|webp|dds)$/i.test(name)) continue;
    if (!/^\s*(?:bounds|xy|rotate|size|orig|offsets|index|split|pad)\s*:/i.test(lines[i + 1])) continue;
    names.add(name);
  }
  return names;
}

function skinValues(skins) {
  if (Array.isArray(skins)) return skins;
  if (skins && typeof skins === 'object') return Object.values(skins);
  return [];
}

// Some Spine exporters prefix attachment paths with a folder/skin namespace
// that is not present in atlas region names (e.g. new/back_hair vs back_hair).
// Rewrite only when the full path is absent and its basename identifies exactly
// one atlas region. Ambiguous names and source attachment keys remain untouched.
export function reconcileSpineJsonAttachmentPaths(skeletonJsonText, atlasText) {
  const skeleton = JSON.parse(String(skeletonJsonText));
  const regions = atlasRegionNames(atlasText);
  const byBasename = new Map();
  for (const region of regions) {
    const basename = region.replace(/\\/g, '/').split('/').pop();
    const matches = byBasename.get(basename) || [];
    matches.push(region);
    byBasename.set(basename, matches);
  }

  let aliases = 0;
  for (const skin of skinValues(skeleton.skins)) {
    const slots = skin?.attachments;
    if (!slots || typeof slots !== 'object') continue;
    for (const attachments of Object.values(slots)) {
      if (!attachments || typeof attachments !== 'object') continue;
      for (const [attachmentName, attachment] of Object.entries(attachments)) {
        if (!attachment || typeof attachment !== 'object' || Array.isArray(attachment)) continue;
        const sourcePath = typeof attachment.path === 'string' && attachment.path
          ? attachment.path
          : attachmentName;
        if (regions.has(sourcePath)) continue;
        const basename = sourcePath.replace(/\\/g, '/').split('/').pop();
        const candidates = byBasename.get(basename) || [];
        if (candidates.length !== 1) continue;
        attachment.path = candidates[0];
        aliases++;
      }
    }
  }
  return {text: JSON.stringify(skeleton), aliases};
}
