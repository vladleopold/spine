const SAFE_SEGMENT = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,219}$/;

function cleanBasePath(value) {
  return String(value || '').trim().replace(/^\/+|\/+$/g, '');
}

/** Only canonical library collections may be configured as upload roots. */
export function isAllowedSpineCollectionBasePath(value) {
  const base = cleanBasePath(value);
  return /^library(?:_[0-9]+)?$/.test(base);
}

/** File names must remain a single safe segment inside the project directory. */
export function isAllowedSpineUploadFileName(value) {
  const name = String(value || '').trim();
  return Boolean(name && name !== '.' && name !== '..' && !name.includes('/') && !name.includes('\\') && SAFE_SEGMENT.test(name));
}

/**
 * New uploads must be stored as one project directory directly inside the
 * configured library collection (library, library_01, library_02, ...).
 * Legacy root-level projects remain readable; this guard only applies to new
 * upload writes.
 */
export function isAllowedSpineUploadPath(value, basePath = 'library') {
  const candidate = String(value || '').trim();
  const base = cleanBasePath(basePath);
  if (!candidate || !isAllowedSpineCollectionBasePath(base) || candidate.includes('\\') || candidate.startsWith('/')) return false;

  const segments = candidate.split('/');
  if (segments.length !== 2 || segments.some((part) => !part || part === '.' || part === '..' || !SAFE_SEGMENT.test(part))) {
    return false;
  }

  const collection = segments[0];
  const shard = collection.startsWith(base + '_') ? collection.slice(base.length + 1) : '';
  const allowedCollection = collection === base || /^[0-9]+$/.test(shard);

  return allowedCollection && segments[1] !== 'index.json' && segments[1] !== 'metrics.json';
}
