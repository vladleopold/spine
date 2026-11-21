const SAFE_SEGMENT = /^[a-zA-Z0-9][a-zA-Z0-9._-]{0,219}$/;

/**
 * New uploads must be stored as one project directory directly inside the
 * configured library collection (library, library_01, library_02, ...).
 * Legacy root-level projects remain readable; this guard only applies to new
 * upload writes.
 */
export function isAllowedSpineUploadPath(value, basePath = 'library') {
  const candidate = String(value || '').trim();
  const base = String(basePath || 'library').trim().replace(/^\/+|\/+$/g, '');
  if (!candidate || !base || candidate.includes('\\') || candidate.startsWith('/')) return false;

  const segments = candidate.split('/');
  if (segments.length !== 2 || segments.some((part) => !part || part === '.' || part === '..' || !SAFE_SEGMENT.test(part))) {
    return false;
  }

  const collection = segments[0];
  const allowedCollection = collection === base || collection.startsWith(base + '_') &&
    new RegExp('^' + base.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '_[0-9]+$').test(collection);

  return allowedCollection && segments[1] !== 'index.json' && segments[1] !== 'metrics.json';
}
