// Resolve skins explicitly declared by the uploaded source config.
// The runtime-native default is tried first. A configured non-default skin is
// retried by name because some player versions do not apply it consistently.
export function configuredPreviewSkinCandidates(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return [];
  const raw = Array.isArray(config.skins)
    ? config.skins
    : (config.skins && typeof config.skins === 'object' ? Object.keys(config.skins) : []);
  const defaultSkin = typeof config.defaultSkin === 'string' ? config.defaultSkin.trim() : '';
  const seen = new Set();
  const result = [];
  const add = value => {
    const name = typeof value === 'string'
      ? value.trim()
      : (value && typeof value.name === 'string' ? value.name.trim() : '');
    if (!name || name.toLowerCase() === 'default' || seen.has(name)) return;
    seen.add(name);
    result.push(name);
  };
  add(defaultSkin);
  // The runtime-native default is represented by null and must never be
  // passed to setSkinByName, including when config.defaultSkin is `default`.
  for (const value of raw) add(value, false);
  return result;
}

 
// Spine 3.8 JSON exports can encode skins as numeric object keys whose values
// carry the actual skin name. Prefer those names; use keys only for older maps.
export function sourcePreviewSkinNames(skins) {
  if (Array.isArray(skins)) {
    return skins.map(skin => typeof skin?.name === 'string' ? skin.name.trim() : '')
      .filter(Boolean);
  }
  if (!skins || typeof skins !== 'object') return [];
  const values = Object.values(skins);
  const names = values.map(skin => typeof skin?.name === 'string' ? skin.name.trim() : '')
    .filter(Boolean);
  return names.length ? names : Object.keys(skins);
}

/**
 * Order preview skins so an explicitly configured default appearance wins.
 * The runtime default remains the fallback for uploads without that setting.
 */
export function orderedPreviewSkinCandidates(config) {
  const configured = configuredPreviewSkinCandidates(config);
  const defaultSkin = typeof config?.defaultSkin === 'string' ? config.defaultSkin.trim() : '';
  const previewSkins = Array.isArray(config?.previewSkins)
    ? [...new Set(config.previewSkins.map(name => typeof name === 'string' ? name.trim() : '').filter(Boolean))]
    : [];
  const result = [];
  if (previewSkins.length) result.push(previewSkins);
  if (defaultSkin && defaultSkin.toLowerCase() !== 'default' && !result.some(item => item === defaultSkin)) {
    result.push(defaultSkin);
  }
  result.push(null);
  for (const name of configured) {
    if (!result.includes(name)) result.push(name);
  }
  return result;
}
