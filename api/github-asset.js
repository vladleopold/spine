const defaultOwner = 'vladleopold';
const defaultRepo = 'spine';
const defaultBranch = 'main';
import { cacheProfiles, setCacheHeaders, setNoStoreHeaders } from '../lib/cache-headers.js';

const memoryCache = globalThis.__spineLinkAssetMemoryCache || {
  entries: new Map(),
  bytes: 0,
};
globalThis.__spineLinkAssetMemoryCache = memoryCache;
const memoryCacheMaxBytes = 64 * 1024 * 1024;
const memoryCacheMaxEntries = 160;
const memoryCacheTtlMs = 10 * 60 * 1000;
const memoryCacheMaxObjectBytes = 16 * 1024 * 1024;
const directRangeProxyMinBytes = 16 * 1024 * 1024;

function cleanRepoPath(value = '') {
  return String(value).trim().replace(/^\/+|\/+$/g, '').replace(/\/+/g, '/');
}

function normalizeRepoPath(value = '') {
  const parts = cleanRepoPath(value).split('/').filter(Boolean);
  const resolved = [];
  for (const part of parts) {
    if (part === '.') continue;
    if (part === '..') {
      resolved.pop();
      continue;
    }
    resolved.push(part);
  }
  return resolved.join('/');
}

function base64ToBuffer(base64) {
  return Buffer.from(String(base64).replace(/\s/g, ''), 'base64');
}

async function contentBufferFromGitHubContent(data, token) {
  if (typeof data?.content === 'string' && data.content.trim()) {
    return base64ToBuffer(data.content);
  }

  if (typeof data?.download_url === 'string' && data.download_url) {
    const rawResponse = await fetch(data.download_url, {
      headers: {
        Authorization: `Bearer ${token}`,
      },
    });
    if (!rawResponse.ok) throw new Error(`Raw asset did not load: ${rawResponse.status}`);
    return Buffer.from(await rawResponse.arrayBuffer());
  }

  throw new Error('Asset content is empty');
}

function contentTypeFor(path) {
  const lowerPath = path.toLowerCase();
  if (lowerPath.endsWith('.json')) return 'application/json; charset=utf-8';
  if (lowerPath.endsWith('.atlas') || lowerPath.endsWith('.atlas.txt') || lowerPath.endsWith('.atlas.docx')) return 'text/plain; charset=utf-8';
  if (lowerPath.endsWith('.png')) return 'image/png';
  if (lowerPath.endsWith('.gif')) return 'image/gif';
  if (lowerPath.endsWith('.jpg') || lowerPath.endsWith('.jpeg')) return 'image/jpeg';
  if (lowerPath.endsWith('.webp')) return 'image/webp';
  if (lowerPath.endsWith('.webm')) return 'video/webm';
  if (lowerPath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (lowerPath.endsWith('.xml')) return 'application/xml; charset=utf-8';
  if (lowerPath.endsWith('.txt')) return 'text/plain; charset=utf-8';
  if (lowerPath.endsWith('.skel')) return 'application/octet-stream';
  return 'application/octet-stream';
}

function isVideoPath(path) {
  return String(path || '').toLowerCase().endsWith('.webm');
}

function isIndexableMediaPath(path) {
  return /\.(png|gif|jpe?g|webp|webm)$/i.test(String(path || ''));
}

function cacheProfileForAsset(path, assetVersion) {
  if (assetVersion) return [cacheProfiles.immutable, cacheProfiles.immutableCdn];
  if (path === 'library/index.json') return [cacheProfiles.listBrowser, cacheProfiles.listCdn];
  if (isIndexableMediaPath(path)) return [cacheProfiles.mediaBrowser, cacheProfiles.mediaCdn];
  return [cacheProfiles.assetBrowser, cacheProfiles.assetCdn];
}

function githubContentSize(data) {
  const size = Number(data?.size || 0);
  return Number.isFinite(size) && size > 0 ? size : 0;
}

function requestMatchesEtag(request, etag) {
  return Boolean(etag && String(request.headers['if-none-match'] || '') === etag);
}

function memoryCacheKey({ owner, repo, branch, path, assetVersion }) {
  return [owner, repo, branch, path, assetVersion].join('\n');
}

function forgetMemoryCacheEntry(key) {
  const cached = memoryCache.entries.get(key);
  if (!cached) return;
  memoryCache.bytes = Math.max(0, memoryCache.bytes - cached.buffer.length);
  memoryCache.entries.delete(key);
}

function getMemoryCacheEntry(key) {
  const cached = memoryCache.entries.get(key);
  if (!cached) return null;
  if (cached.expiresAt <= Date.now()) {
    forgetMemoryCacheEntry(key);
    return null;
  }
  memoryCache.entries.delete(key);
  memoryCache.entries.set(key, cached);
  return cached;
}

function putMemoryCacheEntry(key, entry) {
  if (!entry?.buffer?.length || entry.buffer.length > memoryCacheMaxObjectBytes) return;
  forgetMemoryCacheEntry(key);
  memoryCache.entries.set(key, {
    ...entry,
    expiresAt: Date.now() + memoryCacheTtlMs,
  });
  memoryCache.bytes += entry.buffer.length;

  while (memoryCache.entries.size > memoryCacheMaxEntries || memoryCache.bytes > memoryCacheMaxBytes) {
    const oldestKey = memoryCache.entries.keys().next().value;
    if (!oldestKey) break;
    forgetMemoryCacheEntry(oldestKey);
  }
}

function isAtlasPath(path) {
  const lowerPath = path.toLowerCase();
  return lowerPath.endsWith('.atlas') || lowerPath.endsWith('.atlas.txt') || lowerPath.endsWith('.atlas.docx');
}

function isSkeletonJsonPath(path) {
  return String(path || '').toLowerCase().endsWith('.json');
}

function isSkeletonJsonData(data) {
  return data && typeof data === 'object' && (data.skeleton || data.bones || data.slots || data.skins || data.animations);
}

function sanitizeSkeletonJson(json) {
  if (!json || typeof json !== 'object') return json;
  const attachments = json?.skins?.flatMap((skin) => Object.values(skin || {})) || [];
  for (const slotAttachments of attachments) {
    if (!slotAttachments || typeof slotAttachments !== 'object') continue;
    for (const attachment of Object.values(slotAttachments)) {
      if (!attachment || typeof attachment !== 'object') continue;
      const type = attachment.type;
      if (type === 'mesh' || type === 'linkedmesh') {
        if (type === 'mesh' && !attachment.source) {
          if (!Array.isArray(attachment.uvs)) attachment.uvs = [];
          if (!Array.isArray(attachment.vertices)) attachment.vertices = [];
          if (!Array.isArray(attachment.triangles)) attachment.triangles = [];
        }
        if (type === 'linkedmesh' && !attachment.source) {
          if (!Array.isArray(attachment.uvs)) attachment.uvs = [];
          if (!Array.isArray(attachment.vertices)) attachment.vertices = [];
          if (!Array.isArray(attachment.triangles)) attachment.triangles = [];
        }
      }
    }
  }
  return json;
}

function sanitizeSkeletonData(json) {
  return sanitizeSkeletonJson(json);
}

function byteRangeFromHeader(rangeHeader = '', size = 0) {
  const match = String(rangeHeader).match(/^bytes=(\d*)-(\d*)$/);
  if (!match || size <= 0) return null;
  const startText = match[1];
  const endText = match[2];
  let start = startText ? Number(startText) : 0;
  let end = endText ? Number(endText) : size - 1;

  if (!startText && endText) {
    const suffixLength = Number(endText);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return null;
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  }

  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= size) return null;
  return {
    start,
    end: Math.min(end, size - 1),
  };
}

function sanitizeLibraryIndex(buffer) {
  try {
    const entries = JSON.parse(buffer.toString('utf8'));
    if (!Array.isArray(entries)) return buffer;
    const sanitized = entries.map((entry) => {
      if (!entry || typeof entry !== 'object') return entry;
      const next = { ...entry };
      for (const key of ['thumbnail', 'thumbnailPoster', 'webmPreview']) {
        if (typeof next[key] === 'string' && /^data:/i.test(next[key])) next[key] = '';
      }
      return next;
    });
    return Buffer.from(JSON.stringify(sanitized, null, 2), 'utf8');
  } catch {
    return buffer;
  }
}

function withAtlasPageCacheBuster(buffer, version) {
  if (!version) return buffer;

  const text = buffer.toString('utf8');
  const nextText = text.replace(
    /^([^\r\n:]+?\.(?:png|jpe?g|webp))(?:\?v=[^\r\n]*)?$/gim,
    (_match, pageName) => `${pageName}?v=${encodeURIComponent(version)}`,
  );
  return Buffer.from(nextText, 'utf8');
}

function githubHeaders(token) {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

async function findFallbackGitHubPath({ owner, repo, branch, token, path }) {
  const basename = path.split('/').filter(Boolean).pop() || '';
  const basenameParts = basename.split('.');
  const extension = basenameParts.length > 1 ? `.${basenameParts.pop()}` : '';
  const stem = basenameParts.join('.');
  const duplicatedPrefix = (() => {
    const parts = stem.split('_');
    for (let size = Math.max(1, Math.floor(parts.length / 2)); size >= 1; size -= 1) {
      const left = parts.slice(0, size).join('_');
      const right = parts.slice(size, size * 2).join('_');
      if (left && right && left === right) return `${left}${extension}`;
    }
    return '';
  })();
  const repeatedStemCandidates = [];
  for (let index = 1; index < stem.length - 1; index += 1) {
    if (stem[index] !== '_') continue;
    const left = stem.slice(0, index);
    const right = stem.slice(index + 1);
    if (left && left === right) repeatedStemCandidates.push(`${left}${extension}`);
  }
  const simplifiedBasename = basename.includes('_') ? basename.slice(basename.lastIndexOf('_') + 1) : '';
  const suffixAfterTextures = path.includes('/textures/')
    ? path.slice(path.indexOf('/textures/') + '/textures/'.length)
    : '';
  const treeResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}/git/trees/${encodeURIComponent(branch)}?recursive=1`, {
    headers: githubHeaders(token),
  });
  if (!treeResponse.ok) return '';
  const treeJson = await treeResponse.json();
  const tree = Array.isArray(treeJson?.tree) ? treeJson.tree : [];
  const candidates = new Set([
    path,
    suffixAfterTextures,
    basename,
    simplifiedBasename,
    ...repeatedStemCandidates,
    duplicatedPrefix,
  ].filter(Boolean));
  const match = tree.find((item) => item?.type === 'blob' && candidates.has(String(item?.path || ''))) || tree.find((item) => item?.type === 'blob' && basename && String(item?.path || '').endsWith(`/${basename}`));
  if (match) return String(match?.path || '');
  if (simplifiedBasename) {
    const simplifiedMatch = tree.find((item) => item?.type === 'blob' && String(item?.path || '').endsWith(`/${simplifiedBasename}`));
    if (simplifiedMatch) return String(simplifiedMatch?.path || '');
  }
  return String(match?.path || '');
}

function setAssetResponseHeaders(request, response, { path, assetVersion, etag }) {
  const contentType = contentTypeFor(path);
  const isVideo = isVideoPath(path);
  const [browserCache, cdnCache] = cacheProfileForAsset(path, assetVersion);
  response.setHeader('Content-Type', contentType);
  setCacheHeaders(response, browserCache, cdnCache);
  if (isIndexableMediaPath(path)) response.setHeader('X-Robots-Tag', 'index, follow');
  if (isVideo) response.setHeader('Accept-Ranges', 'bytes');
  if (etag) response.setHeader('ETag', etag);
  if (requestMatchesEtag(request, etag)) return response.status(304).end();
  return null;
}

function sendAssetHeadFromMetadata(request, response, { path, assetVersion, data, etag }) {
  if (request.method !== 'HEAD') return null;
  const earlyResponse = setAssetResponseHeaders(request, response, { path, assetVersion, etag });
  if (earlyResponse) return earlyResponse;
  const size = githubContentSize(data);
  if (size) response.setHeader('Content-Length', String(size));
  response.setHeader('X-Spine-Link-Asset-Head', 'metadata');
  return response.status(200).end();
}

async function sendGitHubRangeAsset(request, response, { path, assetVersion, data, token, etag }) {
  const rangeHeader = request.headers.range;
  const size = githubContentSize(data);
  if (request.method !== 'GET' || !isVideoPath(path) || !rangeHeader || !data?.download_url || size <= directRangeProxyMinBytes) return null;

  const rawResponse = await fetch(data.download_url, {
    headers: {
      Authorization: `Bearer ${token}`,
      Range: rangeHeader,
    },
  });

  if (rawResponse.status !== 206) return null;

  const chunk = Buffer.from(await rawResponse.arrayBuffer());
  setAssetResponseHeaders(request, response, { path, assetVersion, etag });
  setNoStoreHeaders(response);
  response.setHeader('Accept-Ranges', 'bytes');
  response.setHeader('X-Spine-Link-Asset-Range', 'github');
  response.setHeader('X-Spine-Link-Asset-Cache', 'range');
  const contentRange = rawResponse.headers.get('content-range');
  if (contentRange) response.setHeader('Content-Range', contentRange);
  response.setHeader('Content-Length', String(chunk.length));
  return response.status(206).send(chunk);
}

function sendAssetBuffer(request, response, { path, assetVersion, buffer, etag }) {
  const isVideo = isVideoPath(path);
  const rangeHeader = request.headers.range;
  const shouldServeRange = isVideo && rangeHeader && buffer.length > directRangeProxyMinBytes;
  const earlyResponse = setAssetResponseHeaders(request, response, { path, assetVersion, etag });
  if (earlyResponse) return earlyResponse;
  if (isVideo) response.setHeader('Accept-Ranges', shouldServeRange ? 'bytes' : 'none');
  response.setHeader('X-Spine-Link-Asset-Cache', 'memory');

  if (shouldServeRange) {
    setNoStoreHeaders(response);
    const range = byteRangeFromHeader(rangeHeader, buffer.length);
    if (!range) {
      response.setHeader('Content-Range', `bytes */${buffer.length}`);
      response.setHeader('Content-Length', '0');
      return response.status(416).end();
    }
    const chunk = buffer.subarray(range.start, range.end + 1);
    response.setHeader('Content-Range', `bytes ${range.start}-${range.end}/${buffer.length}`);
    response.setHeader('Content-Length', String(chunk.length));
    return response.status(206).send(request.method === 'HEAD' ? '' : chunk);
  }

  response.setHeader('Content-Length', String(buffer.length));
  if (request.method === 'HEAD') {
    return response.status(200).end();
  }
  return response.status(200).send(buffer);
}

export default async function handler(request, response) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.setHeader('Allow', 'GET, HEAD');
    return response.status(405).send('Method not allowed');
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) return response.status(500).send('GITHUB_TOKEN is not configured');

  const path = normalizeRepoPath(request.query?.path || '');
  if (!path) return response.status(400).send('Invalid asset path');
  const assetVersion = typeof request.query?.v === 'string' ? request.query.v : '';

  const owner = process.env.GITHUB_OWNER || defaultOwner;
  const repo = process.env.GITHUB_REPO || defaultRepo;
  const branch = process.env.GITHUB_BRANCH || defaultBranch;
  const encodedPath = encodeURIComponent(path).replace(/%2F/g, '/');
  const cacheKey = memoryCacheKey({ owner, repo, branch, path, assetVersion });
  const cachedAsset = getMemoryCacheEntry(cacheKey);
  if (cachedAsset) {
    response.setHeader('X-Spine-Link-Asset-Memory', 'hit');
    return sendAssetBuffer(request, response, {
      path,
      assetVersion,
      buffer: cachedAsset.buffer,
      etag: cachedAsset.etag,
    });
  }

  try {
    let githubResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`, {
      headers: githubHeaders(token),
    });

    if (!githubResponse.ok) {
      const fallbackPath = await findFallbackGitHubPath({ owner, repo, branch, token, path });
      if (!fallbackPath || fallbackPath === path) return response.status(githubResponse.status).send('Asset not found');
      const fallbackEncodedPath = encodeURIComponent(fallbackPath).replace(/%2F/g, '/');
      githubResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${fallbackEncodedPath}?ref=${encodeURIComponent(branch)}`, {
        headers: githubHeaders(token),
      });
      if (!githubResponse.ok) return response.status(githubResponse.status).send('Asset not found');
    }

    const data = await githubResponse.json();
    const etag = data?.sha ? `"github-${data.sha}${assetVersion ? `-${assetVersion}` : ''}"` : '';
    if (requestMatchesEtag(request, etag)) {
      const earlyResponse = setAssetResponseHeaders(request, response, { path, assetVersion, etag });
      if (earlyResponse) return earlyResponse;
    }
    const headResponse = sendAssetHeadFromMetadata(request, response, { path, assetVersion, data, etag });
    if (headResponse) return headResponse;
    const rangeResponse = await sendGitHubRangeAsset(request, response, { path, assetVersion, data, token, etag });
    if (rangeResponse) return rangeResponse;
    let buffer = await contentBufferFromGitHubContent(data, token);
    if (!buffer.length) return response.status(404).send('Asset is empty');
    if (isAtlasPath(path)) {
      buffer = withAtlasPageCacheBuster(buffer, assetVersion);
    }
    if (path === 'library/index.json') {
      buffer = sanitizeLibraryIndex(buffer);
    }
    putMemoryCacheEntry(cacheKey, { buffer, etag });
    response.setHeader('X-Spine-Link-Asset-Memory', 'miss');
    return sendAssetBuffer(request, response, { path, assetVersion, buffer, etag });
  } catch (error) {
    return response.status(500).send(error instanceof Error ? error.message : 'Asset failed');
  }
}
