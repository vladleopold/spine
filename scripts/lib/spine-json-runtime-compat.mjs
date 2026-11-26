// The bundled Spine 3.8.75 JSON reader consumes `skins` as an array.
// Some valid 3.8 editor exports serialize the same data as an object map;
// the old reader silently skips every skin, leaving no attachments and zero
// bounds. Normalize only the preview response, never the stored source file.
const SKIN_METADATA_KEYS = new Set(['bones', 'ik', 'transform', 'path', 'physics']);

function legacy38SkinRecord(key, value) {
  if (!key || !value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error('Invalid Spine 3.8 skin map entry');
  }
  const name = typeof value.name === 'string' && value.name.trim()
    ? value.name.trim()
    : key;
  const attachments = {};
  const metadata = {};
  for (const [property, child] of Object.entries(value)) {
    if (property === 'name') continue;
    if (property === 'attachments') {
      if (!child || typeof child !== 'object' || Array.isArray(child)) {
        throw new Error('Invalid Spine 3.8 skin attachments');
      }
      Object.assign(attachments, child);
    } else if (SKIN_METADATA_KEYS.has(property)) {
      metadata[property] = child;
    } else {
      attachments[property] = child;
    }
  }
  return { ...metadata, name, attachments };
}

export function normalizeSpineJsonForLegacy38Runtime(source, version) {
  const text = Buffer.isBuffer(source) ? source.toString('utf8') : String(source);
  if (!/^3\\.8(?:[.-]|$)/.test(String(version || '').trim())) return text;
  const data = JSON.parse(text);
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    throw new Error('Invalid Spine JSON root');
  }
  if (!data.skins || Array.isArray(data.skins) || typeof data.skins !== 'object') return text;
  const entries = Object.entries(data.skins);
  data.skins = entries.map(([key, value]) => legacy38SkinRecord(key, value));
  return JSON.stringify(data);
}
