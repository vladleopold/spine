// Give Spine Player a filename extension that matches the actual payload format.
// Spine 4.2/4.3 chooses JSON vs binary from the URL suffix, not Content-Type.
export function resolveSpineRuntimeSkeletonUrl(sourceUrl, format) {
  const source = String(sourceUrl || '');
  if (format !== 'json') return source;

  const suffixIndex = source.search(/[?#]/);
  const pathname = suffixIndex < 0 ? source : source.slice(0, suffixIndex);
  if (/\.json$/i.test(pathname) || !/\.skel$/i.test(pathname)) return source;

  return pathname + '.json' + source.slice(pathname.length);
}
