// Resolve only skins explicitly declared by the uploaded source config.
// The default skin is attempted first via the runtime's native default behavior.
export function configuredPreviewSkinCandidates(config) {
  if (!config || typeof config !== 'object' || Array.isArray(config)) return [];
  const raw = Array.isArray(config.skins)
    ? config.skins
    : (config.skins && typeof config.skins === 'object' ? Object.keys(config.skins) : []);
  const defaultSkin = typeof config.defaultSkin === 'string' ? config.defaultSkin : '';
  const seen = new Set();
  const result = [];
  for (const value of raw) {
    const name = typeof value === 'string'
      ? value.trim()
      : (value && typeof value.name === 'string' ? value.name.trim() : '');
    if (!name || name.toLowerCase() === 'default' || name.toLowerCase() === defaultSkin.toLowerCase() || seen.has(name)) continue;
    seen.add(name);
    result.push(name);
  }
  return result;
}
