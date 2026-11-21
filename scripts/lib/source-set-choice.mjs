function normalizedSourceFileName(value) {
  let source = String(value || '').trim();
  if (!source) return '';
  try {
    source = new URL(source, 'https://spine-source.invalid').pathname;
  } catch {}
  try {
    source = decodeURIComponent(source);
  } catch {}
  return source.replace(/\\/g, '/').split('/').filter(Boolean).pop()?.toLowerCase() || '';
}

function sourceStem(value) {
  return normalizedSourceFileName(value).replace(/\.(?:skel|json|bytes)$/i, '');
}

// Select the one source directory named by the index. Without an indexed
// skeleton, implicit selection is safe only when exactly one set exists.
export function chooseSourceSet(sets, requestedSkeleton, listFiles = () => []) {
  const available = Array.isArray(sets) ? sets : [];
  if (!available.length) return null;
  const requested = normalizedSourceFileName(requestedSkeleton);
  if (!requested) return available.length === 1 ? available[0] : null;

  const requestedStem = sourceStem(requested);
  const matches = available.filter((set) => {
    const names = Array.isArray(set?.files) ? set.files : listFiles(set);
    return (Array.isArray(names) ? names : []).some((file) => {
      const name = normalizedSourceFileName(file);
      return name === requested || (requestedStem && sourceStem(name) === requestedStem);
    });
  });
  return matches.length === 1 ? matches[0] : null;
}
