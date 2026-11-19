// GitHub's Contents API omits file content for large (>1 MiB) files.
// Fetch the public raw index instead so production verification always parses
// the complete published collection index.
export async function fetchPublicIndex(collection, {
  fetchImpl = globalThis.fetch,
  timeoutMs = 30000,
} = {}) {
  if (!/^library(?:_\d+)?$/.test(String(collection || ''))) {
    throw new Error('Unsafe collection');
  }
  if (typeof fetchImpl !== 'function') {
    throw new Error('Fetch implementation unavailable');
  }
  const url = `https://raw.githubusercontent.com/vladleopold/spine/main/${collection}/index.json`;
  const response = await fetchImpl(url, {
    signal: AbortSignal.timeout(timeoutMs),
    cache: 'no-store',
  });
  if (!response?.ok) {
    throw new Error(`Cannot read current index ${response?.status ?? 'unknown'}`);
  }
  const raw = await response.text();
  if (!raw.trim()) throw new Error('Published index response was empty');
  let index;
  try {
    index = JSON.parse(raw);
  } catch {
    throw new Error('Published index is not valid JSON');
  }
  if (!Array.isArray(index)) throw new Error('Invalid published index');
  return index;
}
