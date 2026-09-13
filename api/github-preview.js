import { metricCountsForId, parseMetricsJson } from '../lib/spine-metrics.js';

import { cacheProfiles, setCacheHeaders, setNoStoreHeaders } from '../lib/cache-headers.js';
import { appendAssetVersion, assetVersionForEntry } from '../lib/asset-version.js';
import { cachedGithubText } from '../lib/github-content-cache.js';

const defaultOwner = 'vladleopold';
const defaultRepo = 'spine';
const defaultBranch = 'main';
const defaultBasePath = 'library';

function cleanRepoPath(value = '') {
  return String(value).trim().replace(/^\/+|\/+$/g, '').replace(/\/+/g, '/');
}

function basename(value = '') {
  return String(value).replace(/\\/g, '/').split('/').filter(Boolean).pop() || '';
}

function joinRepoPath(...parts) {
  return parts.map(cleanRepoPath).filter(Boolean).join('/');
}

function encodeRepoPath(path) {
  return cleanRepoPath(path)
    .split('/')
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join('/');
}

function versionedAssetUrl(origin, item, version) {
  return appendAssetVersion(`${origin}/assets/${encodeRepoPath(item.path)}`, version);
}

function assetUrlForRepoPath(origin, path, version = '') {
  return appendAssetVersion(`${origin}/assets/${encodeRepoPath(path)}`, version);
}

function base64ToText(base64) {
  return Buffer.from(String(base64).replace(/\s/g, ''), 'base64').toString('utf8');
}

class SpineBinaryCursor {
  constructor(bytes) {
    this.bytes = bytes;
    this.index = 0;
  }

  skip(count) {
    this.index = Math.min(this.bytes.length, this.index + count);
  }

  readByte() {
    if (this.index >= this.bytes.length) throw new Error('Unexpected end of Spine binary.');
    return this.bytes[this.index++];
  }

  readInt(optimizePositive = true) {
    let byte = this.readByte();
    let result = byte & 0x7f;
    if ((byte & 0x80) !== 0) {
      byte = this.readByte();
      result |= (byte & 0x7f) << 7;
      if ((byte & 0x80) !== 0) {
        byte = this.readByte();
        result |= (byte & 0x7f) << 14;
        if ((byte & 0x80) !== 0) {
          byte = this.readByte();
          result |= (byte & 0x7f) << 21;
          if ((byte & 0x80) !== 0) result |= (this.readByte() & 0x7f) << 28;
        }
      }
    }
    return optimizePositive ? result : ((result >>> 1) ^ -(result & 1));
  }

  readString() {
    const byteCount = this.readInt(true);
    if (byteCount === 0) return null;
    const length = byteCount - 1;
    const start = this.index;
    const end = start + length;
    if (end > this.bytes.length) throw new Error('Invalid Spine binary string length.');
    this.index = end;
    return Buffer.from(this.bytes.slice(start, end)).toString('utf8');
  }
}

function extractVersion(v) {
  const m = String(v).match(/^(\d+\.\d+(?:\.\d+)?)/);
  return m ? m[1] : '';
}

function spineBinaryVersionFromBase64(base64 = '') {
  const bytes = Buffer.from(String(base64).replace(/\s/g, ''), 'base64');
  const legacyCursor = new SpineBinaryCursor(bytes);
  try {
    legacyCursor.readString();
    const version = extractVersion(legacyCursor.readString());
    if (version) return version;
  } catch {
    // Try newer binary header below.
  }

  const cursor = new SpineBinaryCursor(bytes);
  try {
    cursor.skip(8);
    return extractVersion(cursor.readString()) || '';
  } catch {
    return '';
  }
}

function escapedJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
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

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function cleanPublicText(value = '', maxLength = 120) {
  return String(value).trim().slice(0, maxLength);
}

function safePublicImage(value = '') {
  const url = String(value).trim();
  return /^https:\/\/[^\s"'<>]+$/i.test(url) ? url : '';
}

function skinNamesFromSkeletonJson(skeletonJson) {
  if (!skeletonJson || typeof skeletonJson !== 'object' || !('skins' in skeletonJson)) return [];
  const skins = skeletonJson.skins;
  if (Array.isArray(skins)) {
    return skins
      .map((skin) => {
        if (typeof skin === 'string') return skin;
        if (skin && typeof skin === 'object' && typeof skin.name === 'string') return skin.name;
        return '';
      })
      .filter(Boolean);
  }
  if (skins && typeof skins === 'object') return Object.keys(skins).filter(Boolean);
  return [];
}

function preferredSkinName(skinNames) {
  if (!skinNames.length) return '';
  return skinNames.includes('default') ? 'default' : skinNames[0] || '';
}

function extractAtlasPages(atlasText = '') {
  return String(atlasText)
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => /\.(png|jpe?g|webp)$/i.test(line));
}

function canonicalAtlasPageName(pageName = '') {
  return basename(String(pageName || '').replace(/\\/g, '/').trim());
}

function imageMatchesAtlasPage(imageName = '', pageName = '') {
  const imageBase = basename(String(imageName || '').replace(/\\/g, '/').trim()).toLowerCase();
  const pageBase = canonicalAtlasPageName(pageName).toLowerCase();
  if (!imageBase || !pageBase) return false;
  if (imageBase === pageBase) return true;
  if (pageBase.endsWith(imageBase)) return true;
  if (imageBase.endsWith(pageBase)) return true;
  return false;
}

function safePublicVideo(value = '') {
  const url = String(value).trim();
  return /^https:\/\/[^\s"'<>]+\.webm(?:[?#][^\s"'<>]*)?$/i.test(url) ? url : '';
}

function safePublicAsset(value = '') {
  const url = String(value).trim();
  return /^https:\/\/[^\s"'<>]+$/i.test(url) ? url : '';
}

function sanitizeSha256(value = '') {
  const hash = String(value || '').trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(hash) ? hash : '';
}

function shortHash(value = '') {
  const hash = String(value || '').trim();
  return hash.length > 22 ? `${hash.slice(0, 12)}...${hash.slice(-8)}` : hash;
}

function generatedThumbnailUrl(origin, entry) {
  const id = String(entry?.id || '').trim();
  const poster = String(entry?.thumbnailPoster || '');
  return id && /^data:image\/webp;base64,/i.test(poster)
    ? assetUrlForRepoPath(origin, `library/${id}/generated-preview.webp`, assetVersionForEntry(entry, 'generated-preview'))
    : '';
}

function entryImageAsset(value = '', entry = {}, fallback = '') {
  return appendAssetVersion(safePublicImage(value), assetVersionForEntry(entry, fallback));
}

function entryVideoAsset(value = '', entry = {}, fallback = '') {
  return appendAssetVersion(safePublicVideo(value), assetVersionForEntry(entry, fallback));
}

function isoDate(value) {
  const date = value ? new Date(value) : null;
  return date && !Number.isNaN(date.getTime()) ? date.toISOString() : '';
}

function durationToIso8601(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  return `PT${Math.max(1, Math.round(seconds))}S`;
}

function positiveInteger(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? Math.round(number) : 0;
}

function pageUrlForEntry(origin, entryId) {
  return `${origin}/p/${encodeURIComponent(String(entryId || '').trim())}`;
}

function playerUrlForEntry(origin, entry, entryId) {
  const id = encodeURIComponent(String(entry?.id || entryId || '').trim());
  const animation = String(entry?.defaultAnimation || '').trim();
  return animation ? `${origin}/p/${id}?animation=${encodeURIComponent(animation)}` : `${origin}/p/${id}`;
}

function archiveUrlForEntry(origin, entry, entryId) {
  const id = String(entry?.id || entryId || '').trim();
  return id ? `${origin}/world-spine-archive/${encodeURIComponent(id)}` : '';
}

function robotsHeaderValue(value = '') {
  const robots = String(value || '').trim();
  return robots
    ? robots.split(',').map((part) => part.trim()).filter(Boolean).join(', ')
    : 'index, follow, max-image-preview:large, max-video-preview:-1, max-snippet:-1';
}

function entryHasFile(entry, fileName = '') {
  const name = String(fileName || '').trim().toLowerCase();
  return Array.isArray(entry?.files) && entry.files.some((file) => String(file || '').trim().toLowerCase() === name);
}

function sourceProofUrlForEntry(origin, entry) {
  const direct = safePublicAsset(entry?.sourceProofUrl || entry?.sourceProof?.proofUrl);
  if (direct) return direct;
  const path = cleanRepoPath(entry?.sourceProofPath || entry?.sourceProof?.proofPath || '');
  if (path) return `${origin}/assets/${encodeRepoPath(path)}`;
  if (entryHasFile(entry, 'source-proof.json') && entry?.previewPath) {
    return `${origin}/assets/${encodeRepoPath(`${entry.previewPath}/source-proof.json`)}`;
  }
  return '';
}

function blockchainAnchorUrlForEntry(origin, entry) {
  const direct = safePublicAsset(entry?.blockchainAnchor?.anchorUrl || entry?.blockchainAnchor?.github?.anchorUrl);
  if (direct) return direct;
  const path = cleanRepoPath(entry?.blockchainAnchor?.anchorPath || entry?.blockchainAnchor?.github?.anchorPath || '');
  if (path) return `${origin}/assets/${encodeRepoPath(path)}`;
  if (entryHasFile(entry, 'blockchain-anchor.json') && entry?.previewPath) {
    return `${origin}/assets/${encodeRepoPath(`${entry.previewPath}/blockchain-anchor.json`)}`;
  }
  return '';
}

function proofDocumentsForEntry(origin, entry, pageUrl) {
  const sourceProofUrl = sourceProofUrlForEntry(origin, entry);
  const blockchainAnchorUrl = blockchainAnchorUrlForEntry(origin, entry);
  const proofHash = sanitizeSha256(entry?.sourceProof?.proofHash || entry?.blockchainAnchor?.sourceProofHash);
  const anchorHash = sanitizeSha256(entry?.blockchainAnchor?.anchorHash);
  const documents = [];
  if (sourceProofUrl) {
    documents.push({
      '@type': 'DigitalDocument',
      '@id': `${pageUrl}#source-proof`,
      name: 'Spine-Link source origin proof',
      url: sourceProofUrl,
      encodingFormat: 'application/json',
      description:
        'Source-origin proof JSON linking uploaded Spine files to SHA-256 hashes, account/browser evidence, and the GitHub repository path.',
      ...(proofHash
        ? {
            identifier: {
              '@type': 'PropertyValue',
              propertyID: 'SHA-256',
              value: proofHash,
            },
          }
        : {}),
    });
  }
  if (blockchainAnchorUrl) {
    documents.push({
      '@type': 'DigitalDocument',
      '@id': `${pageUrl}#blockchain-anchor`,
      name: 'Spine-Link GitHub blockchain anchor',
      url: blockchainAnchorUrl,
      encodingFormat: 'application/json',
      description:
        'Blockchain anchor JSON linking the source proof hash, GitHub commit receipts, browser/account evidence, and optional EVM transaction data.',
      ...(anchorHash
        ? {
            identifier: {
              '@type': 'PropertyValue',
              propertyID: 'SHA-256',
              value: anchorHash,
            },
          }
        : {}),
    });
  }
  return documents;
}

function textFromEntry(entry, field = 'all') {
  if (!entry || typeof entry !== 'object') return '';
  const files = Array.isArray(entry.files) ? entry.files.join(' ') : '';
  const animations = Array.isArray(entry.animations) ? entry.animations.join(' ') : '';
  const values = {
    all: [entry.id, entry.title, entry.ownerEmail, entry.ownerName, entry.note, entry.skeleton, entry.atlas, files, animations, entry.previewPath, entry.repositoryUrl],
    id: [entry.id],
    title: [entry.title],
    ownerEmail: [entry.ownerEmail],
    ownerName: [entry.ownerName],
    note: [entry.note],
    files: [files],
    animations: [animations],
    path: [entry.previewPath, entry.repositoryUrl],
  };
  return (values[field] || values.all).filter(Boolean).join(' ');
}

function exclusionRuleMatches(entry, rule) {
  if (!rule || rule.enabled === false) return false;
  const pattern = String(rule.pattern || '').trim();
  if (!pattern) return false;
  const haystack = textFromEntry(entry, String(rule.field || 'all'));
  if (!haystack) return false;
  if (rule.type === 'regex') {
    try {
      const flags = String(rule.flags || 'i').replace(/[^dgimsuvy]/g, '') || 'i';
      return new RegExp(pattern, flags).test(haystack);
    } catch {
      return false;
    }
  }
  return haystack.toLowerCase().includes(pattern.toLowerCase());
}

function entryExcludedFromArchive(entry, exclusions) {
  const rules = Array.isArray(exclusions?.rules) ? exclusions.rules : [];
  return rules.some((rule) => exclusionRuleMatches(entry, rule));
}

function isPublicArchiveEntry(entry, exclusions) {
  return Boolean(
    entry &&
      entry.hiddenFromPublicLibrary !== true &&
      (entry.webmPreview || entry.thumbnail || entry.thumbnailPoster) &&
      !entryExcludedFromArchive(entry, exclusions),
  );
}

function videoMetadataForEntry(origin, entry, entryId, note = '', canonicalUrl = '', embedUrl = '') {
  const id = String(entry?.id || entryId || '').trim();
  const contentUrl = entryVideoAsset(entry?.webmPreview || '', entry, 'webm');
  const poster =
    entryImageAsset(entry?.thumbnailPoster || '', entry, 'poster') ||
    generatedThumbnailUrl(origin, entry) ||
    entryImageAsset(entry?.thumbnail || '', entry, 'thumbnail');
  if (!id || !contentUrl || !poster) return null;
  const name = cleanPublicText(entry?.title || id || 'Spine animation preview', 110);
  const description =
    cleanPublicText(note || entry?.note || `${name} Spine animation video preview and interactive Spine web player on Spine-Link.`, 260) ||
    `${name} Spine animation video preview and interactive Spine web player on Spine-Link.`;
  return {
    id,
    name,
    description,
    thumbnailUrl: poster,
    contentUrl,
    embedUrl: embedUrl || pageUrlForEntry(origin, id),
    url: canonicalUrl || pageUrlForEntry(origin, id),
    proofDocuments: proofDocumentsForEntry(origin, entry, canonicalUrl || pageUrlForEntry(origin, id)),
    sourceProofUrl: sourceProofUrlForEntry(origin, entry),
    blockchainAnchorUrl: blockchainAnchorUrlForEntry(origin, entry),
    proofHash: sanitizeSha256(entry?.sourceProof?.proofHash || entry?.blockchainAnchor?.sourceProofHash),
    anchorHash: sanitizeSha256(entry?.blockchainAnchor?.anchorHash),
    uploadDate: isoDate(entry?.uploadedAt) || '2026-05-04T00:00:00.000Z',
    duration: durationToIso8601(entry?.previewDuration),
    width: positiveInteger(entry?.previewWidth),
    height: positiveInteger(entry?.previewHeight),
  };
}

function breadcrumbStructuredData(items) {
  return items.length > 1 ? {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  } : null;
}

function seoHead({
  origin,
  entryId,
  video,
  fallbackTitle = 'Spine-Link',
  robots = 'index,follow,max-image-preview:large,max-video-preview:-1,max-snippet:-1',
  playerUrl = '',
  archiveUrl = '',
}) {
  const title = video?.name ? `${video.name} - Spine animation video preview` : fallbackTitle;
  const description = video?.description || 'Spine-Link interactive Spine animation preview and Spine web viewer.';
  const url = video?.url || (entryId ? pageUrlForEntry(origin, entryId) : origin);
  const image = video?.thumbnailUrl || `${origin}/spine-link-video-thumbnail.png`;
  const structuredData = video
    ? {
        '@context': 'https://schema.org',
        '@type': 'VideoObject',
        '@id': `${video.url}#video`,
        name: video.name,
        description: video.description,
        thumbnailUrl: [video.thumbnailUrl],
        uploadDate: video.uploadDate,
        contentUrl: video.contentUrl,
        embedUrl: video.embedUrl,
        url: video.url,
        mainEntityOfPage: video.url,
        isFamilyFriendly: true,
        ...(Array.isArray(video.proofDocuments) && video.proofDocuments.length
          ? { subjectOf: video.proofDocuments.map((document) => ({ '@id': document['@id'] })) }
          : {}),
        ...(video.duration ? { duration: video.duration } : {}),
        ...(video.width ? { width: video.width } : {}),
        ...(video.height ? { height: video.height } : {}),
        potentialAction: {
          '@type': 'WatchAction',
          target: video.url,
        },
        publisher: {
          '@type': 'Organization',
          name: 'Spine Portfolio',
          alternateName: 'Spine-Link',
          url: origin,
        },
      }
    : null;
  const imageStructuredData = video
    ? {
        '@context': 'https://schema.org',
        '@type': 'ImageObject',
        contentUrl: video.thumbnailUrl,
        url: video.thumbnailUrl,
        name: `${video.name} preview frame`,
        representativeOfPage: true,
      }
    : null;
  const proofStructuredData = video?.proofDocuments?.length
    ? {
        '@context': 'https://schema.org',
        '@graph': video.proofDocuments,
      }
    : null;
  const breadcrumbs = breadcrumbStructuredData([
    { name: 'Spine-Link', url: origin },
    ...(archiveUrl ? [{ name: 'World SPINE ARCHIVE', url: archiveUrl }] : []),
    { name: video?.name || fallbackTitle, url: video?.url || url },
  ]);
  return `
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <meta name="robots" content="${escapeHtml(robots)}" />
    <meta name="googlebot" content="${escapeHtml(robots)}" />
    <meta name="application-name" content="Spine Portfolio" />
    <meta name="apple-mobile-web-app-title" content="Spine Portfolio" />
    <meta name="theme-color" content="#000000" />
    <link rel="canonical" href="${escapeHtml(url)}" />
    ${playerUrl && playerUrl !== url ? `<link rel="alternate" href="${escapeHtml(playerUrl)}" title="Interactive Spine player" />` : ''}
    ${archiveUrl && archiveUrl !== url ? `<link rel="alternate" href="${escapeHtml(archiveUrl)}" title="World SPINE ARCHIVE detail page" />` : ''}
    <meta property="og:type" content="${video ? 'video.other' : 'website'}" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:url" content="${escapeHtml(url)}" />
    <meta property="og:site_name" content="Spine Portfolio" />
    <meta property="og:image" content="${escapeHtml(image)}" />${video ? `
    <meta property="og:video" content="${escapeHtml(video.contentUrl)}" />
    <meta property="og:video:secure_url" content="${escapeHtml(video.contentUrl)}" />
    <meta property="og:video:type" content="video/webm" />
    ${video.width ? `<meta property="og:video:width" content="${video.width}" />` : ''}
    ${video.height ? `<meta property="og:video:height" content="${video.height}" />` : ''}` : ''}
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${escapeHtml(image)}" />${structuredData ? `
    <script type="application/ld+json">${escapedJson(structuredData)}</script>
    <script type="application/ld+json">${escapedJson(imageStructuredData)}</script>${proofStructuredData ? `
    <script type="application/ld+json">${escapedJson(proofStructuredData)}</script>` : ''}` : ''}${breadcrumbs ? `
    <script type="application/ld+json">${escapedJson(breadcrumbs)}</script>` : ''}`;
}

function githubHeaders(token) {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

function isSkeleton(name) {
  const lower = name.toLowerCase();
  return lower.endsWith('.json') || lower.endsWith('.skel');
}

function isAtlas(name) {
  const lower = name.toLowerCase();
  return lower.endsWith('.atlas') || lower.endsWith('.atlas.txt') || lower.endsWith('.atlas.docx');
}

function isImage(name) {
  return /\.(png|jpe?g|webp)$/i.test(name);
}

function stem(name) {
  return name
    .replace(/\.atlas(?:\.txt|\.docx)?$/i, '')
    .replace(/\.(json|skel|png|jpe?g|webp)$/i, '');
}

function viewportFromJson(json) {
  const bounds = json?.skeleton;
  if (
    typeof bounds?.x === 'number' &&
    typeof bounds.y === 'number' &&
    typeof bounds.width === 'number' &&
    typeof bounds.height === 'number'
  ) {
    return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
  }
  return undefined;
}

function animationNamesFromJson(json) {
  return Object.keys(json?.animations || {});
}

function hasPremultipliedAlpha(atlasText = '') {
  const match = String(atlasText).match(/^\s*pma\s*:\s*(true|false)\s*$/im);
  return match ? match[1].toLowerCase() === 'true' : false;
}

function compareLibraryEntries(a, b) {
  const aOrder = Number(a?.libraryOrder);
  const bOrder = Number(b?.libraryOrder);
  const hasAOrder = Number.isFinite(aOrder);
  const hasBOrder = Number.isFinite(bOrder);
  if (hasAOrder && hasBOrder && aOrder !== bOrder) return aOrder - bOrder;
  if (hasAOrder !== hasBOrder) return hasAOrder ? -1 : 1;
  return String(b?.uploadedAt || '').localeCompare(String(a?.uploadedAt || ''));
}

async function githubJson(settings, path) {
  const encodedPath = encodeURIComponent(path).replace(/%2F/g, '/');
  const response = await fetch(`https://api.github.com/repos/${settings.owner}/${settings.repo}/contents/${encodedPath}?ref=${encodeURIComponent(settings.branch)}`, {
    headers: githubHeaders(settings.token),
  });
  if (!response.ok) return null;
  return response.json();
}

async function githubText(settings, path) {
  return cachedGithubText(settings, path);
}

async function githubFileContent(settings, path) {
  const data = await githubJson(settings, path);
  return data && typeof data.content === 'string' ? data.content : '';
}

async function githubFileHead(settings, path, maxBytes = 256) {
  const rawUrl = `https://raw.githubusercontent.com/${settings.owner}/${settings.repo}/${settings.branch}/${encodeRepoPath(path)}`;
  const response = await fetch(rawUrl, {
    headers: {
      Authorization: `Bearer ${settings.token}`,
      Range: `bytes=0-${maxBytes - 1}`,
      Accept: 'application/octet-stream',
    },
  });
  if (!response.ok && response.status !== 206) return '';
  const buffer = Buffer.from(await response.arrayBuffer());
  return buffer.toString('base64');
}

async function githubList(settings, path) {
  const data = await githubJson(settings, path);
  return Array.isArray(data) ? data : [];
}

async function findSpineSetDirectories(settings, uploadPath, maxDepth = 3) {
  const found = [];
  const seen = new Set();
  async function visit(path, depth) {
    const cleanPath = cleanRepoPath(path);
    if (!cleanPath || seen.has(cleanPath) || depth > maxDepth) return;
    seen.add(cleanPath);
    const items = await githubList(settings, cleanPath);
    const hasSkeleton = items.some((item) => item.type === 'file' && isSkeleton(item.name));
    const hasAtlas = items.some((item) => item.type === 'file' && isAtlas(item.name));
    const hasTexture = items.some((item) => item.type === 'file' && isImage(item.name));
    if (hasSkeleton && hasAtlas && hasTexture) {
      found.push({ name: cleanPath.split('/').pop() || cleanPath, path: cleanPath });
      return;
    }
    const directories = items.filter((item) => item.type === 'dir');
    for (const directory of directories) await visit(directory.path, depth + 1);
  }
  await visit(uploadPath, 0);
  return found;
}

function createHtml(config) {
  const video = config.video || null;
  const origin = config.origin || 'https://spine-link.vercel.app';
  const entryMetricId = String(config.entryId || 'spine-preview');
  const metric = metricCountsForId(config.metrics, entryMetricId);
  const clientConfig = {
    ...config,
    metrics: {
      entries: {
        [entryMetricId]: metric,
      },
    },
  };
  const videoPreviewRatio =
    video?.width && video?.height && Number(video.width) > 0 && Number(video.height) > 0
      ? `${Math.round(Number(video.width))} / ${Math.round(Number(video.height))}`
      : '16 / 9';
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    ${seoHead({
      origin,
      entryId: config.entryId,
      video,
      fallbackTitle: 'Spine-Link interactive Spine animation preview',
      robots: config.robots,
      playerUrl: config.playerUrl,
      archiveUrl: config.archiveUrl,
    })}
    <link rel="icon" href="data:," />
    <link rel="stylesheet" href="/page-transitions.css" />
    <link rel="stylesheet" id="spine-player-stylesheet" href="https://cdn.jsdelivr.net/npm/@esotericsoftware/spine-player@4.3.13/dist/spine-player.css" />
    <script src="/page-transitions.js" defer></script>
    <style>
      * { box-sizing: border-box; }
      * { scrollbar-width: thin; scrollbar-color: rgba(74,78,84,.72) transparent; }
      *::-webkit-scrollbar { width: 8px; height: 8px; }
      *::-webkit-scrollbar-track { background: transparent; }
      *::-webkit-scrollbar-thumb { border: 2px solid transparent; border-radius: 999px; background: rgba(74,78,84,.72); background-clip: content-box; }
      *::-webkit-scrollbar-thumb:hover { background: rgba(100,106,115,.78); background-clip: content-box; }
      html, body, #app { width: 100%; min-height: 100%; margin: 0; }
      body { overflow: auto; background: #000; color: #e7edf4; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      #app { position: relative; z-index: 1; display: grid; grid-template-rows: auto auto auto; gap: 18px; min-height: 100vh; padding: 24px; background: rgba(0,0,0,.78); }
      .topbar { display: flex; justify-content: space-between; gap: 18px; align-items: center; }
      .brand-link { display: inline-block; color: inherit; text-decoration: none; }
      .brand-logo { display: inline-flex; align-items: center; gap: 8px; color: #fff; font-family: "Trebuchet MS", Inter, ui-sans-serif, system-ui, sans-serif; font-size: clamp(34px, 4.4vw, 58px); font-weight: 500; line-height: .78; letter-spacing: .18em; text-shadow: 0 0 1px rgba(255,255,255,.86), 0 6px 18px rgba(0,0,0,.42); }
      .brand-spine-mark { display: inline-grid; gap: 4px; width: 16px; margin: 0 -3px 0 -5px; transform: translateY(1px); }
      .brand-spine-mark i { display: block; width: 16px; height: 7px; border-radius: 999px; background: #ff5a1f; box-shadow: 0 0 8px rgba(255,90,31,.22); }
      .brand-spine-mark i:nth-child(1) { transform: translateX(-1px); }
      .brand-spine-mark i:nth-child(2) { width: 14px; transform: translateX(2px); }
      .brand-spine-mark i:nth-child(3) { width: 12px; transform: translateX(4px); }
      .brand-spine-mark i:nth-child(4) { width: 10px; transform: translateX(6px); }
      .brand-spine-mark i:nth-child(5) { width: 8px; transform: translateX(8px); }
      .brand-plus { margin-left: 8px; color: #ff6a28; font-size: .72em; font-weight: 800; letter-spacing: .22em; line-height: 1; text-transform: uppercase; transform: translate(-15px, .18em); }
      .brand-link:hover .brand-plus { color: #8cc7ff; }
      .player-top-actions { display: flex; align-items: center; justify-content: flex-end; gap: 10px; min-width: 0; }
      .player-top-button { display: inline-flex; align-items: center; justify-content: center; min-height: 42px; padding: 0 14px; border: 1px solid rgba(140,199,255,.32); border-radius: 8px; color: #dff1ff; background: rgba(140,199,255,.08); box-shadow: 0 12px 28px rgba(0,0,0,.24), inset 0 0 18px rgba(140,199,255,.06); font-size: 13px; font-weight: 950; text-decoration: none; white-space: nowrap; }
      .player-top-button.is-primary { border-color: rgba(179,255,64,.62); color: #eaffc2; background: rgba(179,255,64,.1); }
      .player-top-button:hover { border-color: rgba(255,106,40,.7); color: #fff; background: rgba(255,106,40,.12); }
      .stage { display: grid; grid-template-columns: minmax(0, 1fr) 400px; gap: 18px; min-height: 560px; height: calc(100vh - 104px); }
      .player-frame { position: relative; min-width: 0; min-height: 0; }
      .video-watch-panel { position: relative; display: grid; gap: 10px; overflow: hidden; padding: 16px; border: 1px solid rgba(255,185,214,.46); border-radius: 8px; background: #020304; box-shadow: 0 20px 64px rgba(0,0,0,.34); }
      .video-watch-panel--bottom { margin-top: 4px; }
      .seo-video-frame { display: flex; align-items: center; justify-content: center; width: 100%; height: min(70vh, 820px); min-height: 220px; max-height: min(70vh, 820px); overflow: hidden; border: 1px solid rgba(140,199,255,.22); border-radius: 8px; background: #000; }
      .video-watch-player, .seo-video-preview { display: block; width: auto; height: auto; max-width: 100%; max-height: 100%; aspect-ratio: var(--video-preview-ratio, 16 / 9); object-fit: contain; background: #000; }
      .video-watch-copy { display: grid; gap: 5px; pointer-events: none; }
      .video-watch-copy h1 { margin: 0; color: #fff; font-size: clamp(24px, 3.4vw, 44px); line-height: 1; letter-spacing: 0; text-shadow: 0 4px 18px rgba(0,0,0,.76); }
      .video-watch-copy p { max-width: 780px; margin: 0; color: rgba(237,245,255,.78); font-size: 14px; line-height: 1.35; }
      #player { width: 100%; height: 100%; min-height: 0; touch-action: none; border: 1px solid rgba(255,255,255,.1); border-radius: 8px; overflow: hidden; background: conic-gradient(#565656 25%, #505052 0 50%, #565656 0 75%, #505052 0); background-size: var(--preview-pattern-size, 140px) var(--preview-pattern-size, 140px); }
      .library-nav-button { position: absolute; top: 50%; z-index: 8; display: grid; place-items: center; width: 52px; min-height: 78px; padding: 0; border: 1px solid rgba(140,199,255,.55); border-radius: 8px; color: #f7fbff; background: rgba(9,13,17,.68); box-shadow: 0 16px 34px rgba(0,0,0,.38), inset 0 0 22px rgba(140,199,255,.08); font-size: 42px; font-weight: 800; line-height: 1; transform: translateY(-50%); backdrop-filter: blur(10px); }
      .library-nav-button:hover { border-color: rgba(179,255,64,.78); background: rgba(23,31,18,.78); }
      .library-nav-button:disabled { display: none; }
      .library-nav-button--prev { left: 14px; }
      .library-nav-button--next { right: 14px; }
      #sidebar { min-height: 0; overflow: auto; display: flex; flex-direction: column; gap: 14px; padding-right: 2px; }
      .preview-card { padding: 16px; border: 1px solid rgba(255,255,255,.08); border-radius: 8px; background: rgba(255,255,255,.05); box-shadow: 0 18px 40px rgba(0,0,0,.18); }
      .preview-top-row { display: grid; grid-template-columns: minmax(0, 1.3fr) minmax(0, .9fr); gap: 12px; align-items: stretch; margin-bottom: 12px; }
      .section-title { margin: 0 0 10px; color: #f7fbff; font-size: 13px; font-weight: 900; letter-spacing: .08em; text-transform: uppercase; }
      .seo-video-card { display: none; }
      .seo-video-card.is-visible { display: block; }
      .preview-like-button { display: inline-flex; align-items: center; justify-content: center; gap: 9px; width: 100%; min-height: 44px; border: 1px solid rgba(255,185,214,.42); border-radius: 999px; color: #ffe4ef; background: rgba(8,9,11,.68); box-shadow: 0 12px 30px rgba(0,0,0,.22); cursor: pointer; }
      .preview-like-button span { color: currentColor; font-size: 22px; line-height: 1; transform: translateY(-1px); }
      .preview-like-button strong { color: currentColor; font-size: 14px; font-weight: 950; line-height: 1; }
      .preview-like-button.is-liked { border-color: rgba(255,118,171,.78); color: #ff76ab; background: rgba(255,118,171,.14); }
      .preview-view-count { display: inline-flex; align-items: center; justify-content: center; gap: 8px; width: 100%; min-height: 34px; margin-top: 8px; color: rgba(231,237,244,.78); font-size: 13px; font-weight: 850; }
      .preview-view-count strong { color: #fff; }
      .proof-card { display: ${video?.sourceProofUrl || video?.blockchainAnchorUrl ? 'grid' : 'none'}; gap: 10px; }
      .proof-card a { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-height: 38px; padding: 0 10px; border: 1px solid rgba(140,199,255,.2); border-radius: 8px; color: #dff1ff; background: rgba(140,199,255,.08); font-size: 12px; font-weight: 850; text-decoration: none; }
      .proof-card a:hover { border-color: rgba(179,255,64,.58); color: #fff; }
      .proof-card code { overflow: hidden; max-width: 132px; color: rgba(237,245,255,.68); font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
      select, button { width: 100%; }
      select { min-height: 48px; padding: 0 12px; border: 1px solid rgba(255,255,255,.12); border-radius: 8px; color: #e7edf4; background: #1a2027; }
      button { min-height: 38px; border: 1px solid rgba(255,255,255,.1); border-radius: 8px; color: rgba(231,237,244,.86); background: rgba(255,255,255,.045); cursor: pointer; }
      button.active, button:hover { border-color: rgba(140,199,255,.82); color: #fff; background: rgba(71,156,255,.22); }
      #animation-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(112px, 1fr)); gap: 8px; }
      .note-text { margin: 0; color: rgba(231,237,244,.88); font-size: 16px; line-height: 1.45; overflow-wrap: anywhere; white-space: pre-wrap; }
      .note-card:empty { display: none; }
      .owner-card { display: none; gap: 12px; }
      .owner-card.is-visible { display: grid; }
      .preview-top-row .preview-card { min-height: 0; }
      .preview-top-row .section-title { margin-bottom: 8px; }
      .preview-top-row .owner-profile { gap: 10px; }
      .preview-top-row .owner-avatar { width: 40px; height: 40px; }
      .preview-top-row .owner-profile strong { font-size: 15px; }
      .preview-top-row .owner-profile span { font-size: 11px; }
      .preview-top-row .like-card { display: grid; align-content: start; gap: 10px; }
      .preview-top-row .like-card .preview-like-button { min-height: 42px; }
      .preview-top-row .preview-view-count { margin-top: 0; }
      .owner-profile { display: flex; align-items: center; gap: 12px; min-width: 0; }
      .owner-avatar { width: 46px; height: 46px; border: 1px solid rgba(255,255,255,.14); border-radius: 50%; object-fit: cover; background: rgba(255,255,255,.08); }
      .owner-avatar-fallback { display: grid; place-items: center; color: #111; font-weight: 900; background: #b3ff40; }
      .owner-profile-text { display: flex; flex: 1 1 auto; align-items: baseline; gap: 40px; min-width: 0; max-width: 100%; flex-wrap: wrap; }
      .owner-profile strong, .owner-profile span { white-space: nowrap; }
      .owner-profile strong { flex: 0 1 auto; min-width: 0; color: #fff; font-size: 16px; overflow-wrap: anywhere; }
      .owner-profile span { flex: 0 0 auto; color: rgba(231,237,244,.62); font-size: 12px; }
      .owner-library { display: none; gap: 10px; }
      .owner-library.is-visible { display: grid; grid-template-columns: repeat(auto-fit, minmax(148px, 1fr)); align-items: stretch; }
      .owner-library a { position: relative; display: block; overflow: hidden; min-height: 154px; border: 1px solid rgba(255,255,255,.09); border-radius: 8px; color: inherit; text-decoration: none; background: rgba(255,255,255,.045); isolation: isolate; }
      .owner-library a::after { content: ""; position: absolute; inset: 0; z-index: 1; background: linear-gradient(rgba(0,0,0,.18), rgba(0,0,0,.18) 45%, rgba(8,10,12,.82)); pointer-events: none; }
      .owner-library a:hover { border-color: rgba(179,255,64,.55); background: rgba(179,255,64,.08); transform: translateY(-2px); }
      .owner-thumb { position: absolute; inset: 0; z-index: 0; width: 100%; height: 100%; border-radius: 0; object-fit: cover; background: rgba(255,255,255,.08); transform: scale(1.08); transform-origin: center; }
      .owner-library a > div { position: absolute; right: 10px; bottom: 10px; left: 10px; z-index: 2; display: grid; gap: 3px; min-width: 0; }
      .owner-library strong, .owner-library span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .owner-library strong { color: #fff; font-size: 13px; text-shadow: 0 2px 12px rgba(0,0,0,.75); }
      .owner-library span { color: rgba(231,237,244,.7); font-size: 11px; }
      @media (max-width: 1024px) {
        * { scrollbar-width: none; }
        *::-webkit-scrollbar { width: 0; height: 0; display: none; }
        html, body, #app { min-height: 100%; }
        body { background: #030404; }
        #app { display: flex; flex-direction: column; gap: 10px; min-height: 100%; padding: 12px 16px 56px; background: #030404; }
        .topbar { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 12px; overflow: hidden; }
        .brand-link { min-width: 0; overflow: hidden; }
        .brand-logo { max-width: 100%; gap: 5px; font-size: clamp(24px, 5.6vw, 30px); letter-spacing: .16em; }
        .brand-spine-mark { gap: 3px; width: 11px; margin: 0 -3px 0 -5px; transform: translateY(0); }
        .brand-spine-mark i { width: 11px; height: 5px; }
        .brand-spine-mark i:nth-child(2) { width: 10px; }
        .brand-spine-mark i:nth-child(3) { width: 9px; }
        .brand-spine-mark i:nth-child(4) { width: 8px; }
        .brand-spine-mark i:nth-child(5) { width: 7px; }
        .brand-plus { margin-left: 5px; font-size: .64em; letter-spacing: .17em; transform: translate(-15px, .16em); }
        .player-top-actions { flex: 0 0 auto; justify-content: flex-end; width: auto; margin-left: auto; }
        .player-top-button { max-width: min(36vw, 120px); min-height: 34px; padding: 0 12px; overflow: hidden; border-color: rgba(179,255,64,.58); border-radius: 8px; color: #efffd8; background: rgba(179,255,64,.08); font-size: clamp(12px, 2.8vw, 15px); text-overflow: ellipsis; box-shadow: none; }
        .stage { display: contents; }
        #sidebar { display: contents; }
        .player-frame { order: 2; height: auto; min-height: 0; }
        .preview-top-row { order: 1; display: grid; grid-template-columns: minmax(0, 1fr) auto auto; align-items: center; gap: clamp(8px, 2vw, 16px); min-width: 0; margin: 4px clamp(0px, 3.6vw, 32px) 10px; overflow: hidden; }
        .preview-card { padding: 0; border: 0; border-radius: 0; background: transparent; box-shadow: none; }
        .preview-top-row .section-title, .like-card .section-title { display: none; }
        .owner-card.is-visible { display: block; min-width: 0; }
        .preview-top-row .owner-profile { gap: clamp(8px, 1.7vw, 12px); min-width: 0; }
        .preview-top-row .owner-avatar { flex: 0 0 clamp(54px, 8.9vw, 80px); width: clamp(54px, 8.9vw, 80px); height: clamp(54px, 8.9vw, 80px); aspect-ratio: 1 / 1; border: 0; border-radius: 50%; }
        .owner-profile-text { display: grid; gap: 3px; min-width: 0; }
        .preview-top-row .owner-profile strong { overflow: hidden; min-width: 0; color: #fff; font-size: clamp(19px, 4.4vw, 28px); font-weight: 950; line-height: 1.05; text-overflow: ellipsis; }
        .preview-top-row .owner-profile span { overflow: hidden; min-width: 0; color: rgba(231,237,244,.48); font-size: clamp(12px, 2.8vw, 17px); font-weight: 850; letter-spacing: .14em; line-height: 1; text-transform: uppercase; text-overflow: ellipsis; }
        .preview-top-row .like-card { display: contents; }
        .preview-view-count { order: 2; display: inline-flex; width: auto; min-width: 0; min-height: 44px; margin: 0; gap: clamp(6px, 1.2vw, 9px); color: rgba(231,237,244,.84); font-size: clamp(20px, 4.5vw, 28px); font-weight: 950; white-space: nowrap; }
        .preview-view-count span:last-child { display: none; }
        .preview-view-count span:first-child { position: relative; flex: 0 0 clamp(18px, 3.2vw, 24px); width: clamp(18px, 3.2vw, 24px); height: clamp(12px, 2.2vw, 16px); overflow: hidden; border: 2px solid currentColor; border-radius: 50% / 62%; color: rgba(231,237,244,.76); font-size: 0; }
        .preview-view-count span:first-child::after { content: ""; position: absolute; top: 50%; left: 50%; width: 34%; aspect-ratio: 1 / 1; border-radius: 50%; background: currentColor; transform: translate(-50%, -50%); }
        .preview-view-count strong { font-size: clamp(22px, 4.8vw, 30px); }
        .preview-like-button { order: 3; width: clamp(68px, 10vw, 86px); height: clamp(68px, 10vw, 86px); min-height: 0; padding: 0; gap: clamp(4px, 1vw, 7px); border-color: rgba(255,118,171,.76); border-radius: 50%; color: #ff8dbc; background: rgba(74,18,39,.5); box-shadow: none; font-size: 24px; }
        .preview-like-button span { font-size: clamp(24px, 4.6vw, 32px); }
        .preview-like-button strong { font-size: clamp(20px, 4.2vw, 28px); }
        #player { width: 100%; height: min(86vw, 600px); min-height: 360px; border-color: rgba(255,255,255,.18); border-radius: 12px; background-size: 132px 132px; }
        .spine-player-controls { min-height: 84px; }
        .library-nav-button { display: none; }
        .animation-card { order: 3; margin: 12px 32px 0; }
        .animation-card .section-title { margin: 0 0 10px; font-size: 16px; letter-spacing: .14em; }
        #animation-list { grid-template-columns: 1fr; gap: 6px; }
        #animation-list button { min-height: 38px; border-color: rgba(140,199,255,.78); border-radius: 8px; color: #f1f7ff; background: rgba(31,58,91,.72); font-size: 14px; font-weight: 850; }
        #set-card, .note-card, .proof-card, .owner-library { order: 4; margin-inline: 32px; }
        .video-watch-panel { display: none; }
        .seo-video-frame { max-height: min(62vh, 520px); }
      }
      @media (max-width: 560px) {
        #app { padding: 10px 12px 56px; }
        .topbar { grid-template-columns: minmax(0, 1fr) auto; justify-items: stretch; }
        .brand-logo { font-size: clamp(21px, 6.2vw, 28px); letter-spacing: .14em; }
        .player-top-actions { justify-self: end; margin-left: 0; }
        .player-top-button { max-width: min(34vw, 116px); min-height: 34px; padding-inline: 9px; }
        .preview-top-row { grid-template-columns: minmax(0, 1fr) auto auto; margin: 2px 0 10px; }
        .preview-like-button { width: 60px; height: 60px; }
      }
      .spine-link-loop-button { position: relative; margin-right: 12px !important; }
      .spine-player-controls { z-index: 4; }
      .spine-player-controls.spine-player-controls-hidden { pointer-events: auto; opacity: 1; }
      .spine-link-loop-button::before, .spine-link-loop-button::after { position: absolute; inset: 0; display: grid; place-items: center; font-size: 30px; font-weight: 900; line-height: 1; }
      .spine-link-loop-button.is-on::before { content: "↻"; color: #54cfff; text-shadow: 0 0 14px rgba(84, 207, 255, 0.72); transform: translateY(-1px); }
      .spine-link-loop-button.is-off::before { content: "↻"; color: rgba(210, 216, 222, 0.42); transform: translateY(-1px); }
      .spine-link-loop-button.is-off::after { content: none; }
    </style>
  </head>
      <body>
    <div id="app">
      <header class="topbar">
        <a class="brand-link" href="/" aria-label="Spine-Link home"><span class="brand-logo" aria-hidden="true"><span>s</span><span>p</span><span class="brand-spine-mark"><i></i><i></i><i></i><i></i><i></i></span><span>n</span><span>e</span><span class="brand-plus">link</span></span></a>
        <nav class="player-top-actions" aria-label="Spine-Link player navigation">
          <a class="player-top-button is-primary" href="/">Create preview</a>
        </nav>
      </header>
      <div class="stage">
        <div class="player-frame">
          <button class="library-nav-button library-nav-button--prev" id="library-nav-prev" type="button" aria-label="Previous Spine work" title="Previous Spine work">&lsaquo;</button>
          <div id="player"></div>
          <button class="library-nav-button library-nav-button--next" id="library-nav-next" type="button" aria-label="Next Spine work" title="Next Spine work">&rsaquo;</button>
        </div>
        <aside id="sidebar">
          <div class="preview-card" id="set-card"><div class="section-title">Set</div><select id="set-select"></select></div>
          <div class="preview-top-row">
            <div class="preview-card owner-card" id="owner-card"><div class="section-title">Creator</div><div id="owner-profile"></div></div>
            <div class="preview-card like-card" data-metric-id="${escapeHtml(entryMetricId)}" data-metric-label="stats" aria-label="${metric.likes} likes and ${metric.views} views"><div class="section-title">Metrics</div><button class="preview-like-button" id="preview-like-button" type="button" data-metric-id="${escapeHtml(entryMetricId)}" data-metric-like data-metric-current-likes="${metric.likes}" data-metric-current-views="${metric.views}" aria-pressed="false"><span data-metric-like-icon aria-hidden="true">♡</span><strong data-metric-likes>${metric.likes}</strong></button><div class="preview-view-count" data-metric-id="${escapeHtml(entryMetricId)}"><span aria-hidden="true">◉</span><strong data-metric-views>${metric.views}</strong><span>views</span></div></div>
          </div>
          <div class="preview-card note-card" id="note-card"><div class="section-title">Text</div><p class="note-text" id="note-text"></p></div>
          <div class="preview-card animation-card"><div class="section-title">Animations</div><div id="animation-list"></div></div>
          ${video?.sourceProofUrl || video?.blockchainAnchorUrl ? `<div class="preview-card proof-card"><div class="section-title">Origin proof</div>${video.sourceProofUrl ? `<a href="${escapeHtml(video.sourceProofUrl)}" target="_blank" rel="noreferrer">source-proof.json${video.proofHash ? `<code>${escapeHtml(shortHash(video.proofHash))}</code>` : ''}</a>` : ''}${video.blockchainAnchorUrl ? `<a href="${escapeHtml(video.blockchainAnchorUrl)}" target="_blank" rel="noreferrer">blockchain-anchor.json${video.anchorHash ? `<code>${escapeHtml(shortHash(video.anchorHash))}</code>` : ''}</a>` : ''}</div>` : ''}
          <div class="preview-card owner-library" id="owner-library"></div>
        </aside>
      </div>
      ${video ? `<section class="video-watch-panel video-watch-panel--bottom" aria-label="${escapeHtml(video.name)} video preview">
        <div class="section-title">Video preview</div>
        <div class="seo-video-frame" style="--video-preview-ratio: ${escapeHtml(videoPreviewRatio)}">
          <video class="video-watch-player seo-video-preview" src="${escapeHtml(video.contentUrl)}" poster="${escapeHtml(video.thumbnailUrl)}" muted playsinline preload="metadata" autoplay controls></video>
        </div>
        <div class="video-watch-copy"><h1>${escapeHtml(video.name)}</h1><p>${escapeHtml(video.description)}</p></div>
      </section>` : ''}
    </div>
    <script type="application/json" id="spine-preview-config">${escapedJson(clientConfig)}</script>
    <script>
      // Keep the preview static on load; the Spine player is already the active animated surface.
      if (window.spine?.GLTexture) {
        window.spine.GLTexture.DISABLE_UNPACK_PREMULTIPLIED_ALPHA_WEBGL = true;
      }
      const config = JSON.parse(document.getElementById("spine-preview-config").textContent);
      const sets = config.sets || [];
      function queryValue(name) { return new URLSearchParams(window.location.search).get(name) || ""; }
      function setHasAnimation(set, animationName) { return Boolean(set && animationName && (set.animations || []).includes(animationName)); }
      function initialSet() {
        const querySet = queryValue("set");
        const queryAnimation = queryValue("animation");
        return sets.find((set) => set.label === querySet) || sets.find((set) => setHasAnimation(set, queryAnimation)) || sets.find((set) => set.label === config.activeLabel) || sets[0];
      }
      function initialAnimation(set) {
        const queryAnimation = queryValue("animation");
        return setHasAnimation(set, queryAnimation) ? queryAnimation : set?.animation || "";
      }
      const activeSet = { value: initialSet() };
      const activeAnimation = { name: initialAnimation(activeSet.value) };
      const loopEnabled = { value: true };
      const currentZoom = { value: config.zoom || 1 };
      const baseViewport = { value: null };
      const animationNames = { value: activeSet.value?.animations || [] };
      const animationList = document.getElementById("animation-list");
      const setCard = document.getElementById("set-card");
      const setSelect = document.getElementById("set-select");
      const noteCard = document.getElementById("note-card");
      const noteText = document.getElementById("note-text");
      const ownerCard = document.getElementById("owner-card");
      const ownerProfile = document.getElementById("owner-profile");
      const ownerLibrary = document.getElementById("owner-library");
      const libraryNavPrev = document.getElementById("library-nav-prev");
      const libraryNavNext = document.getElementById("library-nav-next");
      const previewLikeButton = document.getElementById("preview-like-button");
      const profileNavigationItems = Array.isArray(config.ownerProfile?.navigation) ? config.ownerProfile.navigation : [];
      function normalizedPath(url) {
        try {
          return new URL(url, window.location.origin).pathname.replace(/\\/+$/, "");
        } catch {
          return "";
        }
      }
      function currentNavigationIndex() {
        const currentPath = window.location.pathname.replace(/\\/+$/, "");
        return profileNavigationItems.findIndex((item) => normalizedPath(item?.url || "") === currentPath);
      }
      function siblingNavigationUrl(direction) {
        if (profileNavigationItems.length < 2) return "";
        const index = currentNavigationIndex();
        if (index < 0) return "";
        const nextIndex = direction === "previous" ? index - 1 : index + 1;
        if (nextIndex < 0 || nextIndex >= profileNavigationItems.length) return "";
        return profileNavigationItems[nextIndex]?.url || "";
      }
      function navigateSibling(direction) {
        const url = siblingNavigationUrl(direction);
        if (url) window.location.href = url;
      }
      function syncLibraryNavigationButtons() {
        const previousUrl = siblingNavigationUrl("previous");
        const nextUrl = siblingNavigationUrl("next");
        if (libraryNavPrev) {
          libraryNavPrev.disabled = !previousUrl;
          libraryNavPrev.onclick = () => navigateSibling("previous");
        }
        if (libraryNavNext) {
          libraryNavNext.disabled = !nextUrl;
          libraryNavNext.onclick = () => navigateSibling("next");
        }
      }
      const playerElement = document.getElementById("player");
const pinchDistance = { value: null };
       const panPosition = { value: null };
       const swipeStart = { value: null };
       const touchPanPosition = { value: null };
      let player;
      const runtimeLoaders = new Map();
      function legacyRuntimeForSet(set) {
        const version = String(set?.skeletonVersion || "");
        if (/^3\\.7(?:\\.|$)/.test(version)) return "3.7";
        if (/^3\\.8(?:\\.|$)/.test(version)) return "3.8";
        return "";
      }
      function setPlayerStylesheet(href) {
        const link = document.getElementById("spine-player-stylesheet");
        if (link && link.getAttribute("href") !== href) link.setAttribute("href", href);
      }
      function loadScriptOnce(src) {
        return new Promise((resolve, reject) => {
          const existing = document.querySelector('script[src="' + src + '"]');
          if (existing?.dataset.loaded === "true") {
            resolve();
            return;
          }
          if (existing) {
            existing.addEventListener("load", () => resolve(), { once: true });
            existing.addEventListener("error", () => reject(new Error("Could not load " + src)), { once: true });
            return;
          }
          const script = document.createElement("script");
          script.src = src;
          script.async = true;
          script.onload = () => {
            script.dataset.loaded = "true";
            resolve();
          };
          script.onerror = () => reject(new Error("Could not load " + src));
          document.head.appendChild(script);
        });
      }
      function loadSpineRuntime(set) {
        const runtime = legacyRuntimeForSet(set);
        const key = runtime || "4.3.13";
        if (!runtimeLoaders.has(key)) {
          runtimeLoaders.set(key, (async () => {
            if (runtime) {
              setPlayerStylesheet("/vendor-spine-player-" + runtime + ".css");
              await loadScriptOnce("/vendor-spine-player-" + runtime + ".js");
            } else {
              setPlayerStylesheet("https://cdn.jsdelivr.net/npm/@esotericsoftware/spine-player@4.3.13/dist/spine-player.css");
              await loadScriptOnce("https://cdn.jsdelivr.net/npm/@esotericsoftware/spine-player@4.3.13/dist/iife/spine-player.js");
            }
            if (!window.spine?.SpinePlayer) throw new Error("Spine runtime could not be loaded.");
            if (window.spine?.GLTexture) window.spine.GLTexture.DISABLE_UNPACK_PREMULTIPLIED_ALPHA_WEBGL = true;
            return window.spine.SpinePlayer;
          })());
        }
        return runtimeLoaders.get(key);
      }
      function syncUrl(replace = false) {
        if (!activeSet.value || !activeAnimation.name) return;
        const url = new URL(window.location.href);
        if (sets.length > 1) url.searchParams.set("set", activeSet.value.label);
        else url.searchParams.delete("set");
        url.searchParams.set("animation", activeAnimation.name);
        const nextUrl = url.pathname + url.search + url.hash;
        if (nextUrl === window.location.pathname + window.location.search + window.location.hash) return;
        window.history[replace ? "replaceState" : "pushState"]({}, "", nextUrl);
      }
      function applySelectionFromUrl() {
        const nextSet = initialSet();
        activeSet.value = nextSet;
        activeAnimation.name = initialAnimation(nextSet);
        syncSetInfo();
        renderAnimationList();
        createPlayer();
      }
      function syncSetInfo() {
        if (!activeSet.value) return;
        animationNames.value = activeSet.value.animations || [];
        setCard.style.display = sets.length > 1 ? "" : "none";
        setSelect.value = activeSet.value.label;
        const note = String(config.note || "").trim();
        noteText.textContent = note;
        noteCard.style.display = note ? "" : "none";
      }
      function renderSetList() { setSelect.innerHTML = ""; sets.forEach((set) => { const option = document.createElement("option"); option.value = set.label; option.textContent = set.label; setSelect.appendChild(option); }); }
      function playOwnerThumb(video) {
        const source = video?.dataset?.videoSrc || "";
        if (!source) return;
        if (!video.getAttribute("src")) video.setAttribute("src", source);
        video.muted = true;
        video.playsInline = true;
        video.play().catch(() => {});
      }
      function stopOwnerThumb(video) {
        if (!video) return;
        video.pause();
        try { video.currentTime = 0; } catch {}
      }
      function renderOwnerCard() {
        const owner = config.ownerProfile || {};
        const items = Array.isArray(owner.library) ? owner.library : [];
        ownerCard.classList.toggle("is-visible", Boolean(owner.visible));
        ownerLibrary.classList.toggle("is-visible", Boolean(owner.visible && items.length));
        ownerProfile.innerHTML = "";
        ownerLibrary.innerHTML = "";
        if (!owner.visible) return;
        ownerProfile.className = "owner-profile";
        const avatar = owner.picture ? document.createElement("img") : document.createElement("div");
        avatar.className = owner.picture ? "owner-avatar" : "owner-avatar owner-avatar-fallback";
        if (owner.picture) {
          avatar.src = owner.picture;
          avatar.alt = "";
        } else {
          avatar.setAttribute("aria-hidden", "true");
          avatar.textContent = String(owner.name || "S").slice(0, 1).toUpperCase();
        }
        const ownerText = document.createElement("div");
        ownerText.className = "owner-profile-text";
        const ownerName = document.createElement("strong");
        ownerName.textContent = owner.name || "anonim";
        const ownerSubtitle = document.createElement("span");
        ownerSubtitle.textContent = owner.subtitle || "Public Spine library";
        ownerText.append(ownerName, ownerSubtitle);
        ownerProfile.append(avatar, ownerText);
        if (owner.url) {
          ownerProfile.style.cursor = "pointer";
          ownerProfile.onclick = () => { window.location.href = owner.url; };
          ownerProfile.title = "Open public library";
        }
        items.forEach((item) => {
          const link = document.createElement("a");
          link.href = item.url;
          const thumbSrc = item.thumbnailType === "gif" ? item.thumbnailPoster || "" : item.thumbnail || item.thumbnailPoster || "";
          const videoSrc = item.webmPreview || "";
          const thumb = videoSrc ? document.createElement("video") : thumbSrc ? document.createElement("img") : document.createElement("div");
          thumb.className = "owner-thumb";
          if (videoSrc) {
            thumb.dataset.videoSrc = videoSrc;
            if (item.thumbnailPoster) thumb.poster = item.thumbnailPoster;
            thumb.muted = true;
            thumb.loop = false;
            thumb.playsInline = true;
            thumb.preload = "none";
            thumb.setAttribute("aria-hidden", "true");
          } else if (thumbSrc) {
            thumb.src = thumbSrc;
            thumb.alt = "";
          }
          const text = document.createElement("div");
          const title = document.createElement("strong");
          title.textContent = item.title || "Spine preview";
          const meta = document.createElement("span");
          meta.textContent = (item.animations || 0) + " animations";
          text.append(title, meta);
          link.append(thumb, text);
          ownerLibrary.appendChild(link);
        });
      }
      function installOwnerLibraryChaos() {
        const visibleVideos = new Set();
        const manualVideos = new WeakSet();
        const hoverTimers = new WeakMap();
        let chaosTimer = 0;
        function clearHoverTimer(video) {
          const timer = hoverTimers.get(video);
          if (timer) window.clearTimeout(timer);
          hoverTimers.delete(video);
        }
        function startHoverLoop(video) {
          manualVideos.add(video);
          clearHoverTimer(video);
          video.onended = () => {
            const timer = window.setTimeout(() => {
              if (!manualVideos.has(video)) return;
              try { video.currentTime = 0; } catch {}
              playOwnerThumb(video);
            }, 1000);
            hoverTimers.set(video, timer);
          };
          playOwnerThumb(video);
        }
        function stopHoverLoop(video) {
          manualVideos.delete(video);
          clearHoverTimer(video);
          stopOwnerThumb(video);
        }
        function scheduleChaos() {
          window.clearTimeout(chaosTimer);
          chaosTimer = window.setTimeout(runChaos, 800 + Math.random() * 2000);
        }
        function randomSample(items, count) {
          return items
            .map((item) => ({ item, sort: Math.random() }))
            .sort((a, b) => a.sort - b.sort)
            .slice(0, count)
            .map((entry) => entry.item);
        }
        function runChaos() {
          const videos = Array.from(visibleVideos).filter((video) => video.isConnected && (video.dataset.videoSrc || video.getAttribute("src")));
          if (!videos.length) {
            scheduleChaos();
            return;
          }
          const activeLimit = Math.min(4, Math.max(2, Math.ceil(videos.length * 0.35)));
          randomSample(videos.filter((video) => !video.paused && !manualVideos.has(video)), videos.length).slice(activeLimit).forEach(stopOwnerThumb);
          randomSample(videos.filter((video) => video.paused && !manualVideos.has(video)), activeLimit).forEach((video) => {
            if (Math.random() < 0.92) {
              playOwnerThumb(video);
              window.setTimeout(() => {
                if (!manualVideos.has(video) && visibleVideos.has(video) && Math.random() < 0.7) stopOwnerThumb(video);
              }, 1200 + Math.random() * 3000);
            }
          });
          videos.forEach((video) => {
            if (!manualVideos.has(video) && !video.paused && Math.random() < 0.4) stopOwnerThumb(video);
          });
          scheduleChaos();
        }
        document.querySelectorAll(".owner-library a").forEach((link) => {
          const video = link.querySelector("video.owner-thumb");
          if (!video) return;
          link.addEventListener("pointerenter", () => startHoverLoop(video));
          link.addEventListener("focusin", () => startHoverLoop(video));
          link.addEventListener("pointerleave", () => stopHoverLoop(video));
          link.addEventListener("focusout", () => stopHoverLoop(video));
        });
        if ("IntersectionObserver" in window) {
          const observer = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
              const video = entry.target.querySelector("video.owner-thumb");
              if (!video) return;
              if (entry.isIntersecting && entry.intersectionRatio >= 0.42) {
                visibleVideos.add(video);
              } else {
                visibleVideos.delete(video);
                if (!manualVideos.has(video)) stopOwnerThumb(video);
              }
            });
            scheduleChaos();
          }, { threshold: [0, 0.42, 0.68, 1] });
          document.querySelectorAll(".owner-library a").forEach((link) => observer.observe(link));
        } else {
          document.querySelectorAll("video.owner-thumb").forEach((video) => visibleVideos.add(video));
        }
        document.addEventListener("visibilitychange", () => {
          if (document.hidden) {
            window.clearTimeout(chaosTimer);
            visibleVideos.forEach((video) => { if (!manualVideos.has(video)) stopOwnerThumb(video); });
          } else {
            scheduleChaos();
          }
        });
        window.addEventListener("pagehide", () => {
          window.clearTimeout(chaosTimer);
          visibleVideos.forEach(stopOwnerThumb);
        }, { once: true });
        scheduleChaos();
      }
      function rememberBaseViewport() { if (!player?.currentViewport) return; const v = player.currentViewport; baseViewport.value = { x: v.x, y: v.y, width: v.width * currentZoom.value, height: v.height * currentZoom.value, padLeft: v.padLeft * currentZoom.value, padRight: v.padRight * currentZoom.value, padTop: v.padTop * currentZoom.value, padBottom: v.padBottom * currentZoom.value }; }
      function touchDistance(touches) { const a = touches.item(0), b = touches.item(1); if (!a || !b) return 0; return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY); }
      function applyZoom(nextZoom) { currentZoom.value = Math.min(4, Math.max(0.25, Number(nextZoom))); playerElement.style.setProperty("--preview-pattern-size", (140 * currentZoom.value) + "px"); const b = baseViewport.value; if (!b || !player?.currentViewport) return; const cx = b.x + b.width / 2, cy = b.y + b.height / 2, width = b.width / currentZoom.value, height = b.height / currentZoom.value; const next = { x: cx - width / 2, y: cy - height / 2, width, height, padLeft: b.padLeft / currentZoom.value, padRight: b.padRight / currentZoom.value, padTop: b.padTop / currentZoom.value, padBottom: b.padBottom / currentZoom.value }; player.previousViewport = { ...next }; player.currentViewport = next; player.viewportTransitionStart = performance.now(); }
      function updateLoopButtonState(button) { button.classList.toggle("is-on", loopEnabled.value); button.classList.toggle("is-off", !loopEnabled.value); button.title = loopEnabled.value ? "Loop on" : "Loop off"; button.setAttribute("aria-label", button.title); button.setAttribute("aria-pressed", String(loopEnabled.value)); }
      function setTrackLoop() { const entry = player?.animationState?.getCurrent?.(0); if (entry) entry.loop = loopEnabled.value; }
      function disableMix() { if (player?.animationState?.data) player.animationState.data.defaultMix = 0; }
      function playActiveAnimationFromStart() { if (!player || !activeAnimation.name) return; disableMix(); const entry = player.setAnimation(activeAnimation.name, loopEnabled.value); if (entry) { entry.mixDuration = 0; entry.mixTime = 0; entry.listener = { ...(entry.listener || {}), complete: () => { if (!loopEnabled.value) player.pause(); } }; } player.play(); }
      function togglePlayback() { if (!player) return; if (player.paused === false) { player.pause(); return; } playActiveAnimationFromStart(); }
      function installLoopButton() { const buttons = player?.dom?.querySelector(".spine-player-buttons"); const playButton = buttons?.querySelector(".spine-player-button"); if (!buttons || !playButton) return; playButton.onclick = (event) => { event.preventDefault(); event.stopPropagation(); togglePlayback(); }; if (buttons.querySelector(".spine-link-loop-button")) return; const button = document.createElement("button"); button.type = "button"; button.className = "spine-player-button spine-link-loop-button"; updateLoopButtonState(button); button.onclick = (event) => { event.preventDefault(); event.stopPropagation(); loopEnabled.value = !loopEnabled.value; setTrackLoop(); updateLoopButtonState(button); }; playButton.insertAdjacentElement("afterend", button); }
      function panByPixels(deltaX, deltaY) { const v = player?.currentViewport, b = baseViewport.value, canvas = player?.canvas; if (!v || !b || !canvas) return; const totalWidth = v.width + v.padLeft + v.padRight, totalHeight = v.height + v.padTop + v.padBottom; const worldDeltaX = deltaX / Math.max(1, canvas.clientWidth) * totalWidth, worldDeltaY = deltaY / Math.max(1, canvas.clientHeight) * totalHeight; v.x -= worldDeltaX; v.y += worldDeltaY; b.x -= worldDeltaX * currentZoom.value; b.y += worldDeltaY * currentZoom.value; player.previousViewport = { ...v }; player.viewportTransitionStart = performance.now(); }
      async function createPlayer() { if (!activeSet.value) return; player?.dispose(); document.getElementById("player").innerHTML = ""; baseViewport.value = null; const SpinePlayer = await loadSpineRuntime(activeSet.value); player = new SpinePlayer("player", { ...activeSet.value, showControls: true, showLoading: true, alpha: true, preserveDrawingBuffer: false, backgroundColor: "00000000", success: (loadedPlayer) => { player = loadedPlayer; const names = player?.skeleton?.data?.animations?.map((animation) => animation.name) ?? []; const filteredNames = names.filter(name => !name.startsWith('Backup/')); if (filteredNames.length) { animationNames.value = filteredNames; const queryAnimation = queryValue("animation"); if (queryAnimation && filteredNames.includes(queryAnimation)) activeAnimation.name = queryAnimation; if (!activeAnimation.name || !filteredNames.includes(activeAnimation.name)) activeAnimation.name = activeSet.value?.animation && filteredNames.includes(activeSet.value.animation) ? activeSet.value.animation : filteredNames[0]; renderAnimationList(); syncUrl(); } disableMix(); installLoopButton(); playActiveAnimationFromStart(); requestAnimationFrame(() => { rememberBaseViewport(); applyZoom(currentZoom.value); }); }, error: (_player, message) => { const box = document.getElementById("player"); if (box) box.innerHTML = '<div style="display:grid;place-items:center;height:100%;padding:24px;color:#ffb088;font-weight:900;text-align:center;">Spine player error: ' + String(message || "could not load animation").replace(/[<>&]/g, "") + '</div>'; } }); }
      function renderAnimationList() { animationList.innerHTML = ""; animationNames.value.forEach((animationName) => { const button = document.createElement("button"); button.type = "button"; button.textContent = animationName; button.className = animationName === activeAnimation.name ? "active" : ""; button.onclick = () => { activeAnimation.name = animationName; syncUrl(); playActiveAnimationFromStart(); applyZoom(currentZoom.value); renderAnimationList(); }; animationList.appendChild(button); }); }
      function syncPreviewLike() {
        return;
      }
      playerElement.addEventListener("wheel", (event) => { event.preventDefault(); applyZoom(currentZoom.value + (event.deltaY > 0 ? -0.1 : 0.1)); }, { passive: false });
playerElement.addEventListener("touchstart", (event) => {
         if (event.touches.length === 2) {
           swipeStart.value = null;
           pinchDistance.value = touchDistance(event.touches);
           return;
         }
         if (event.touches.length === 1) {
           const touch = event.touches.item(0);
           swipeStart.value = touch ? { x: touch.clientX, y: touch.clientY, time: performance.now() } : null;
           touchPanPosition.value = touch ? { x: touch.clientX, y: touch.clientY } : null;
         }
       }, { passive: false });
       playerElement.addEventListener("touchmove", (event) => {
         if (event.touches.length === 2 && pinchDistance.value !== null) {
           event.preventDefault();
           const nextDistance = touchDistance(event.touches);
           applyZoom(currentZoom.value + (nextDistance - pinchDistance.value) / 220);
           pinchDistance.value = nextDistance;
         } else if (event.touches.length === 1 && touchPanPosition.value) {
           event.preventDefault();
           const touch = event.touches.item(0);
           if (!touch) return;
           const deltaX = touch.clientX - touchPanPosition.value.x;
           const deltaY = touch.clientY - touchPanPosition.value.y;
           touchPanPosition.value = { x: touch.clientX, y: touch.clientY };
           panByPixels(deltaX, deltaY);
         }
       }, { passive: false });
       playerElement.addEventListener("touchend", (event) => {
         pinchDistance.value = null;
         touchPanPosition.value = null;
         const start = swipeStart.value;
         swipeStart.value = null;
         if (!start || event.changedTouches.length !== 1) return;
         const touch = event.changedTouches.item(0);
         if (!touch) return;
         const deltaX = touch.clientX - start.x;
         const deltaY = touch.clientY - start.y;
         const elapsed = performance.now() - start.time;
         if (elapsed > 800 || Math.abs(deltaX) < 64 || Math.abs(deltaX) < Math.abs(deltaY) * 1.35) return;
         navigateSibling(deltaX < 0 ? "next" : "previous");
       });
       playerElement.addEventListener("touchcancel", () => { pinchDistance.value = null; swipeStart.value = null; touchPanPosition.value = null; });
       playerElement.addEventListener("click", (event) => {
         if (event.target.closest(".spine-player-controls")) return;
         event.preventDefault();
         event.stopImmediatePropagation();
         if (event.button === 2) togglePlayback();
       }, true);
       playerElement.addEventListener("dblclick", (event) => {
         if (event.target.closest(".spine-player-controls")) return;
         event.preventDefault();
         event.stopImmediatePropagation();
       }, true);
       playerElement.addEventListener("contextmenu", (event) => { event.preventDefault(); event.stopImmediatePropagation(); }, true);
       playerElement.addEventListener("mousedown", (event) => {
         if (event.button !== 0) return;
         event.preventDefault();
         event.stopImmediatePropagation();
         panPosition.value = { x: event.clientX, y: event.clientY };
       }, true);
       window.addEventListener("mousemove", (event) => { if (!panPosition.value) return; event.preventDefault(); event.stopImmediatePropagation(); const deltaX = event.clientX - panPosition.value.x, deltaY = event.clientY - panPosition.value.y; panPosition.value = { x: event.clientX, y: event.clientY }; panByPixels(deltaX, deltaY); }, { passive: false, capture: true });
       window.addEventListener("mouseup", (event) => { if (event.button !== 0) return; event.preventDefault(); event.stopImmediatePropagation(); panPosition.value = null; }, true);
      setSelect.onchange = () => { activeSet.value = sets.find((set) => set.label === setSelect.value) || sets[0]; activeAnimation.name = activeSet.value?.animation || ""; syncSetInfo(); renderAnimationList(); syncUrl(); createPlayer(); };
      window.addEventListener("popstate", applySelectionFromUrl);
      renderSetList(); syncSetInfo(); renderOwnerCard(); installOwnerLibraryChaos(); syncPreviewLike(); syncLibraryNavigationButtons(); syncUrl(true); createPlayer(); renderAnimationList();
    </script>
    <script>window.SpineLinkMetricsConfig = { viewId: ${JSON.stringify(entryMetricId)} };</script>
    <script src="/spine-metrics.js" defer></script>
  </body>
</html>`;
}

function createVideoFallbackHtml({ origin, entry, ownerProfile, note, entryId, metrics, videoSeo, robots, playerUrl, archiveUrl }) {
  const title = cleanPublicText(entry?.title || entryId || 'Spine preview');
  const poster = entryImageAsset(entry?.thumbnailPoster || '', entry, 'poster') || generatedThumbnailUrl(origin, entry);
  const video = entryVideoAsset(entry?.webmPreview || '', entry, 'webm') || `${origin}/v_holder.webm`;
  const ownerUrl = ownerProfile?.url || (entry?.publicOwnerId ? `${origin}/u/${encodeURIComponent(String(entry.publicOwnerId))}` : '/');
  const metricId = String(entryId || title);
  const metric = metricCountsForId(metrics, metricId);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    ${seoHead({ origin, entryId, video: videoSeo, fallbackTitle: `${title} - Spine-Link video preview`, robots, playerUrl, archiveUrl })}
    <link rel="stylesheet" href="/page-transitions.css" />
    <script src="/page-transitions.js" defer></script>
    <style>
      * { box-sizing: border-box; }
      body { min-height: 100vh; margin: 0; color: #edf5ff; background: #050607; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      .page { display: grid; gap: 18px; width: min(980px, calc(100% - 32px)); margin: 0 auto; padding: 28px 0 42px; }
      .topbar { display: flex; justify-content: space-between; align-items: center; gap: 14px; }
      .brand { color: #ff6a28; font-weight: 950; letter-spacing: .16em; text-transform: uppercase; }
      .back { color: #b3ff40; font-weight: 800; text-decoration: none; }
      .video-card { overflow: hidden; border: 2px solid rgba(255,185,214,.72); border-radius: 8px; background: #111; box-shadow: 0 24px 80px rgba(0,0,0,.42); }
      video { display: block; width: 100%; aspect-ratio: 16 / 9; object-fit: cover; background: #000; }
      .body { display: grid; gap: 10px; padding: 18px; background: rgba(17,17,20,.86); }
      h1 { margin: 0; color: #fff; font-size: clamp(28px, 6vw, 48px); line-height: 1; }
      p { margin: 0; color: rgba(237,245,255,.72); font-size: 16px; line-height: 1.45; }
      .preview-like-button { justify-self: start; display: inline-flex; align-items: center; gap: 9px; min-height: 42px; padding: 0 14px; border: 1px solid rgba(255,185,214,.42); border-radius: 999px; color: #ffe4ef; background: rgba(8,9,11,.68); cursor: pointer; }
      .preview-like-button span { font-size: 22px; transform: translateY(-1px); }
      .preview-like-button strong { font-size: 14px; font-weight: 950; }
      .preview-like-button.is-liked { border-color: rgba(255,118,171,.78); color: #ff76ab; background: rgba(255,118,171,.14); }
      .preview-view-count { display: inline-flex; align-items: center; gap: 8px; color: rgba(237,245,255,.72); font-size: 14px; font-weight: 850; }
      .preview-view-count strong { color: #fff; }
    </style>
  </head>
  <body>
    <main class="page">
      <div class="topbar"><div class="brand">Spine-Link</div><a class="back" href="${ownerUrl}">Open portfolio</a></div>
      <section class="video-card">
        <video src="${escapeHtml(video)}"${poster ? ` poster="${escapeHtml(poster)}"` : ''} muted playsinline preload="metadata" autoplay controls></video>
        <div class="body">
          <h1>${title}</h1>
          ${note ? `<p>${cleanPublicText(note, 240)}</p>` : '<p>This older library item uses the portfolio video holder because its original Spine source files are no longer available.</p>'}
          <button class="preview-like-button" id="preview-like-button" type="button" data-metric-id="${escapeHtml(metricId)}" data-metric-like data-metric-current-likes="${metric.likes}" data-metric-current-views="${metric.views}" aria-pressed="false"><span data-metric-like-icon aria-hidden="true">♡</span><strong data-metric-likes>${metric.likes}</strong></button>
          <div class="preview-view-count" data-metric-id="${escapeHtml(metricId)}" data-metric-label="stats" aria-label="${metric.likes} likes and ${metric.views} views"><span aria-hidden="true">◉</span><strong data-metric-views>${metric.views}</strong><span>views</span></div>
        </div>
      </section>
    </main>
    <script>window.SpineLinkMetricsConfig = { viewId: ${JSON.stringify(metricId)} };</script>
    <script src="/spine-metrics.js" defer></script>
  </body>
</html>`;
}

async function createDynamicPreview(settings, uploadPath, origin) {
  const setDirectories = await findSpineSetDirectories(settings, uploadPath);
  const sets = [];
  let note = '';
  let ownerProfile = null;
  let entry = null;
  let exclusions = { rules: [] };
  const pathParts = cleanRepoPath(uploadPath).split('/').filter(Boolean);
  const indexPath = joinRepoPath(pathParts.slice(0, -1).join('/'), 'index.json');
  const metricsPath = joinRepoPath(settings.basePath || defaultBasePath, 'metrics.json');
  const exclusionsPath = joinRepoPath(settings.basePath || defaultBasePath, 'archive-exclusions.json');
  const uploadId = pathParts[pathParts.length - 1] || '';
  const entryId = uploadId || uploadPath;
  let entries = [];
  let metrics = {};

  for (const directory of setDirectories) {
    const items = await githubList(settings, directory.path);
    const skeleton = items.find((item) => item.type === 'file' && isSkeleton(item.name));
    const atlas = items.find((item) => item.type === 'file' && isAtlas(item.name));
    const textures = items.filter((item) => item.type === 'file' && isImage(item.name));
    if (!skeleton || !atlas || textures.length === 0) continue;

    let skeletonJson = null;
    let skeletonVersion = '';
    const atlasText = await githubText(settings, atlas.path);
    if (skeleton.name.toLowerCase().endsWith('.json')) {
      try {
        skeletonJson = sanitizeSkeletonData(JSON.parse(await githubText(settings, skeleton.path)));
        skeletonVersion = typeof skeletonJson?.skeleton?.spine === 'string' ? skeletonJson.skeleton.spine : '';
      } catch {
        skeletonJson = null;
      }
    } else if (skeleton.name.toLowerCase().endsWith('.skel')) {
      skeletonVersion = spineBinaryVersionFromBase64(await githubFileHead(settings, skeleton.path, 256));
    }

    const animations = animationNamesFromJson(skeletonJson);
    const skinNames = skinNamesFromSkeletonJson(skeletonJson);
    const atlasPages = extractAtlasPages(atlasText);
    const textureUrls = atlasPages.map((pageName) => {
      const matchedTexture =
        textures.find((texture) => imageMatchesAtlasPage(texture.name, pageName)) ??
        (textures.length === 1 ? textures[0] : null);
      return matchedTexture ? versionedAssetUrl(origin, matchedTexture, matchedTexture.sha) : 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO5U9WcAAAAASUVORK5CYII=';
    });
    const defaultAnimation =
      animations.find((name) => name.toLowerCase() === 'idle') ??
      animations.find((name) => name.toLowerCase().includes('idle')) ??
      animations[0] ??
      '';

    const assetVersion = [skeleton.sha, atlas.sha, ...textures.map((texture) => texture.sha)].filter(Boolean).join('-');

    const skeletonUrl = `${origin}/assets/${encodeRepoPath(skeleton.path)}`;
    const atlasUrl = versionedAssetUrl(origin, atlas, assetVersion);
    sets.push({
      label: directory.name,
      skeleton: skeletonUrl,
      ...(skeleton.name.toLowerCase().endsWith('.skel') ? { skelUrl: skeletonUrl } : { jsonUrl: skeletonUrl }),
      atlas: atlasUrl,
      atlasUrl,
      animation: defaultAnimation,
      animations,
      skeletonVersion,
      textures: textureUrls,
      skin: preferredSkinName(skinNames),
      premultipliedAlpha: hasPremultipliedAlpha(atlasText),
      viewport: viewportFromJson(skeletonJson)
        ? { ...viewportFromJson(skeletonJson), padLeft: '14%', padRight: '14%', padTop: '14%', padBottom: '14%' }
        : { padLeft: '14%', padRight: '14%', padTop: '14%', padBottom: '14%' },
    });
  }

  try {
    const indexText = indexPath ? await githubText(settings, indexPath) : '';
    const metricsText = metricsPath ? await githubText(settings, metricsPath) : '';
    const exclusionsText = exclusionsPath ? await githubText(settings, exclusionsPath) : '';
    metrics = parseMetricsJson(metricsText);
    exclusions = exclusionsText ? JSON.parse(exclusionsText) : { rules: [] };
    entries = indexText ? JSON.parse(indexText) : [];
    entry = Array.isArray(entries)
      ? entries.find((item) => item?.id === uploadId || cleanRepoPath(item?.previewPath || '') === cleanRepoPath(uploadPath))
      : null;
    note = String(entry?.note || '').trim();
    if (entry?.showOwnerLibrary) {
      const ownerEmail = String(entry?.ownerEmail || '').toLowerCase();
      const ownerAnonId = String(entry?.ownerAnonId || '').toLowerCase();
      const ownerEntries = Array.isArray(entries)
        ? entries.filter((item) => {
            const itemEmail = String(item?.ownerEmail || '').toLowerCase();
            const itemAnonId = String(item?.ownerAnonId || '').toLowerCase();
            const sameOwner = (ownerEmail && itemEmail === ownerEmail) || (ownerAnonId && itemAnonId === ownerAnonId);
            return sameOwner && item?.showOwnerLibrary;
          })
        : [];
      ownerEntries.sort(compareLibraryEntries);
      const ownerLibraryItems = ownerEntries.map((item) => ({
        title: cleanPublicText(item?.title || item?.id || 'Spine preview'),
        url: `${origin}/p/${encodeURIComponent(String(item?.id || '').trim())}`,
        thumbnail: item?.thumbnailType === 'gif' || /^data:image\/gif;base64,/i.test(String(item?.thumbnail || '')) ? '' : entryImageAsset(item?.thumbnail || '', item, 'thumbnail'),
        thumbnailPoster: entryImageAsset(item?.thumbnailPoster || '', item, 'poster') || generatedThumbnailUrl(origin, item),
        webmPreview: entryVideoAsset(item?.webmPreview || '', item, 'webm') || `${origin}/v_holder.webm`,
        thumbnailType: '',
        animations: Array.isArray(item?.animations) ? item.animations.length : 0,
      }));
      ownerProfile = {
        visible: true,
        name: cleanPublicText(entry.ownerName || ownerEmail.split('@')[0] || 'anonim'),
        picture: safePublicImage(entry.ownerPicture || ''),
        subtitle: `${ownerEntries.length} SPINE WORK'S`,
        url: entry.publicOwnerId ? `${origin}/u/${encodeURIComponent(String(entry.publicOwnerId))}` : '',
        library: ownerLibraryItems.slice(0, 6),
        navigation: ownerLibraryItems.map((item) => ({ title: item.title, url: item.url })),
      };
    }
  } catch {
    note = '';
  }
  const publicArchiveEntry = isPublicArchiveEntry(entry, exclusions);
  const playerUrl = publicArchiveEntry ? playerUrlForEntry(origin, entry, entryId) : pageUrlForEntry(origin, entryId);
  const archiveUrl = publicArchiveEntry ? archiveUrlForEntry(origin, entry, entryId) : '';
  const canonicalUrl = publicArchiveEntry ? playerUrl : '';
  const robots = entry && (entry.hiddenFromPublicLibrary === true || entryExcludedFromArchive(entry, exclusions))
    ? 'noindex,follow'
    : 'index,follow,max-image-preview:large,max-video-preview:-1,max-snippet:-1';
  const video = videoMetadataForEntry(origin, entry, entryId, note, canonicalUrl, playerUrl);
  if (sets.length === 0) {
    return {
      html: createVideoFallbackHtml({ origin, entry, ownerProfile, note, entryId, metrics, videoSeo: video, robots, playerUrl, archiveUrl }),
      robots,
    };
  }
  return {
    html: createHtml({ sets, note, ownerProfile, entryId, origin, video, metrics, robots, playerUrl, archiveUrl }),
    robots,
  };
}

export default async function handler(request, response) {
  if (!['GET', 'HEAD'].includes(request.method)) {
    response.setHeader('Allow', 'GET, HEAD');
    return response.status(405).send('Method not allowed');
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) return response.status(500).send('GITHUB_TOKEN is not configured');

  const path = cleanRepoPath(request.query?.path || '');
  if (!path) return response.status(400).send('Invalid preview path');

  const settings = {
    owner: process.env.GITHUB_OWNER || defaultOwner,
    repo: process.env.GITHUB_REPO || defaultRepo,
    branch: process.env.GITHUB_BRANCH || defaultBranch,
    basePath: cleanRepoPath(process.env.GITHUB_BASE_PATH || defaultBasePath),
    token,
  };
  const origin = `${request.headers['x-forwarded-proto'] || 'https'}://${request.headers['x-forwarded-host'] || request.headers.host}`;

  try {
    let html = '';
    let robotsHeader = 'index,follow,max-image-preview:large,max-video-preview:-1,max-snippet:-1';
    if (path.endsWith('.html')) {
      html = await githubText(settings, path);
      if (!html) return response.status(404).send('Preview not found');
    } else {
      const preview = await createDynamicPreview(settings, path, origin);
      html = preview.html;
      robotsHeader = preview.robots;
    }

    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.setHeader('X-Robots-Tag', robotsHeaderValue(robotsHeader));
    if (request.method === 'HEAD') {
      setNoStoreHeaders(response);
      return response.status(200).send('');
    }
    setCacheHeaders(response, cacheProfiles.dynamicHtmlBrowser, cacheProfiles.dynamicHtmlCdn);
    return response.status(200).send(html);
  } catch (error) {
    return response.status(500).send(error instanceof Error ? error.message : 'Preview failed');
  }
}
