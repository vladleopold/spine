// The bundled Spine 3.8.75 JSON reader consumes `skins` as an array.
// Some valid 3.8 editor exports serialize the same data as an object map;
// the old reader silently skips every skin, leaving no attachments and zero
// bounds. Normalize only the preview response, never the stored source file.
export function normalizeSpineJsonForLegacy38Runtime(source, version) {
  const text = Buffer.isBuffer(source) ? source.toString('utf8') : String(source);
  if (!/^3\\.8(?:[.-]|$)/.test(String(version || '').trim())) return text;
  const data = JSON.parse(text);
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Invalid Spine JSON root');
  }
  if (!data.skins || Array.isArray(data.skins) || typeof data.skins !== 'object') return text;
  const entries = Object.entries(data.skins);
  data.skins = entries.map(([key, value]) => {
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      throw new Error('Invalid Spine 3.8 skin map entry');
    }
    const name = typeof value.name === 'string' && value.name.trim() ? value.name.trim() : key;
    if (!name) throw new Error('Spine 3.8 skin map entry has no name');
    return { ...value, name };
  });
  return JSON.stringify(data);
}
