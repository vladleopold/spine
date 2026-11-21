const SAFE_SEGMENT = /^[\\p{L}\\p{N}][\\p{L}\\p{N}\\p{M} ._()+,-]{0,219}$/u;

function cleanBasePath(value) {
  return String(value || '').trim().replace(/^\/+|\/+$/g, '');
}

/** Only canonical library collections may be configured as upload roots. */
export function isAllowedSpineCollectionBasePath(value) {
  const base = cleanBasePath(value);
  return /^library(?:_[0-9]+)?$/.test(base);
}

/** Relative asset paths may be nested, but every segment must be safe. */
export function isAllowedSpineUploadFileName(value) {
  const name = String(value || '').trim();
  if (!name || name.startsWith('/') || name.includes('\\')) return false;
  const segments = name.split('/');
  return segments.every((part) => part && part !== '.' && part !== '..' && SAFE_SEGMENT.test(part));
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

/** Any project artifact write must stay below a validated collection/project pair. */
export function isAllowedSpineProjectFilePath(value, basePath = 'library') {
  const candidate = String(value || '').trim();
  if (!candidate || candidate.startsWith('/') || candidate.includes('\\\\')) return false;
  const segments = candidate.split('/');
  if (segments.length < 3 || segments.some((part) => !part || part === '.' || part === '..' || !SAFE_SEGMENT.test(part))) return false;
  return isAllowedSpineUploadPath(segments.slice(0, 2).join('/'), basePath);
}
