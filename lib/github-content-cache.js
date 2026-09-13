const textCache = globalThis.__spineLinkGithubTextCache || {
  entries: new Map(),
  bytes: 0,
};
globalThis.__spineLinkGithubTextCache = textCache;

const defaultTtlMs = 90 * 1000;
const maxEntries = 96;
const maxBytes = 8 * 1024 * 1024;
const maxObjectBytes = 2 * 1024 * 1024;

function cleanRepoPath(value = '') {
  return String(value).trim().replace(/^\/+|\/+$/g, '').replace(/\/+/g, '/');
}

function base64ToText(base64) {
  return Buffer.from(String(base64).replace(/\s/g, ''), 'base64').toString('utf8');
}

function githubHeaders(token) {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

function cacheKey(settings, path) {
  return [settings.owner, settings.repo, settings.branch, cleanRepoPath(path)].join('\n');
}

function forgetEntry(key) {
  const cached = textCache.entries.get(key);
  if (!cached) return;
  textCache.bytes = Math.max(0, textCache.bytes - cached.bytes);
  textCache.entries.delete(key);
}

function getEntry(key) {
  const cached = textCache.entries.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    forgetEntry(key);
    return null;
  }
  textCache.entries.delete(key);
  textCache.entries.set(key, cached);
  return cached.value;
}

function putEntry(key, value, ttlMs) {
  const bytes = Buffer.byteLength(value, 'utf8');
  if (bytes > maxObjectBytes) return;
  forgetEntry(key);
  textCache.entries.set(key, {
    bytes,
    value,
    expiresAt: Date.now() + ttlMs,
  });
  textCache.bytes += bytes;

  while (textCache.entries.size > maxEntries || textCache.bytes > maxBytes) {
    const oldestKey = textCache.entries.keys().next().value;
    if (!oldestKey) break;
    forgetEntry(oldestKey);
  }
}

export async function cachedGithubText(settings, path, options = {}) {
  const ttlMs = Number(options.ttlMs || defaultTtlMs);
  const key = cacheKey(settings, path);
  const cached = getEntry(key);
  if (cached !== null) return cached;

  const encodedPath = encodeURIComponent(cleanRepoPath(path)).replace(/%2F/g, '/');
  const response = await fetch(`https://api.github.com/repos/${settings.owner}/${settings.repo}/contents/${encodedPath}?ref=${encodeURIComponent(settings.branch)}`, {
    headers: githubHeaders(settings.token),
  });
  if (!response.ok) return '';
  const data = await response.json();
  let text = data?.content ? base64ToText(data.content) : '';
  if (!text && data?.download_url) {
    const rawResponse = await fetch(data.download_url);
    if (rawResponse.ok) text = await rawResponse.text();
  }
  if (text) putEntry(key, text, Number.isFinite(ttlMs) && ttlMs > 0 ? ttlMs : defaultTtlMs);
  return text;
}
