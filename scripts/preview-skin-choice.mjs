// Resolve skins explicitly declared by the uploaded source config.
// The runtime-native default is tried first; the configured default is the first
// explicit retry because it may differ from Spine's implicit default skin.
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
    if (!name || seen.has(name)) return;
    seen.add(name);
    result.push(name);
  };
  add(defaultSkin);
  for (const value of raw) add(value);
  return result;
}
