function fileName(value) {
  let path = String(value || '');
  try {
    path = new URL(path).pathname;
  } catch {}
  try {
    path = decodeURIComponent(path);
  } catch {}
  return path.split(String.fromCharCode(92)).join('/').split('/').filter(Boolean).pop() || '';
}

// Resolve the one source set named by the index. Basenames are compared for
// compatibility with older index records; ambiguity fails closed.
export function resolveIndexedPreviewSet(sets, entry) {
  const skeleton = fileName(entry?.skeleton);
  const atlas = fileName(entry?.atlas);
  if (!skeleton && !atlas) return null;

  const matches = (Array.isArray(sets) ? sets : []).filter((set) => {
    const skeletonMatches = !skeleton || fileName(set?.skeleton) === skeleton;
    const atlasMatches = !atlas || fileName(set?.atlasUrl || set?.atlas) === atlas;
    return skeletonMatches && atlasMatches;
  });
  if (matches.length !== 1) return null;

  return {
    set: matches[0],
    animation: typeof entry?.defaultAnimation === 'string' ? entry.defaultAnimation : '',
  };
}
