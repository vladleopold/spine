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
  for (const value of raw) add(value);
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
