import { metricCountsForId, parseMetricsJson } from '../lib/spine-metrics.js';
import { cacheProfiles, setCacheHeaders } from '../lib/cache-headers.js';
import { appendAssetVersion, assetVersionForEntry } from '../lib/asset-version.js';
import { cachedGithubText } from '../lib/github-content-cache.js';

const defaultOwner = 'vladleopold';
const defaultRepo = 'spine';
const defaultBranch = 'main';
const defaultBasePath = 'library';

function cleanRepoPath(value = '') {
  return String(value).trim().replace(/^\/+|\/+$/g, '').replace(/\/+/g, '/');
}

function base64ToText(base64) {
  return Buffer.from(String(base64).replace(/\s/g, ''), 'base64').toString('utf8');
}

function escapeHtml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function jsonScript(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

function cleanPublicText(value = '', maxLength = 240) {
  return String(value).replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function safeImage(value = '') {
  const url = String(value).trim();
  return /^https:\/\/[^\s"'<>]+$/i.test(url) ? url : '';
}

function safeVideo(value = '') {
  const url = String(value).trim();
  return /^https:\/\/[^\s"'<>]+$/i.test(url) ? url : '';
}

function entryImageAsset(value = '', entry = {}, fallback = '') {
  return safeImage(value);
}

function entryVideoAsset(value = '', entry = {}, fallback = '') {
  // Use webmGeneratedAt as cache-buster for video so CDN serves the latest generated preview
  return safeVideo(value);
}

function safeAsset(value = '') {
  const url = String(value).trim();
  return /^https:\/\/[^\s"'<>]+$/i.test(url) ? url : '';
}

function encodeRepoPath(path) {
  return cleanRepoPath(path)
    .split('/')
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join('/');
}

function sanitizeSha256(value = '') {
  const hash = String(value || '').trim().toLowerCase();
  return /^[a-f0-9]{64}$/.test(hash) ? hash : '';
}

function shortHash(value = '') {
  const hash = String(value || '').trim();
  return hash.length > 22 ? `${hash.slice(0, 12)}...${hash.slice(-8)}` : hash;
}

function textFromEntry(entry, field = 'all') {
  if (!entry || typeof entry !== 'object') return '';
  const files = Array.isArray(entry.files) ? entry.files.join(' ') : '';
  const animations = Array.isArray(entry.animations) ? entry.animations.join(' ') : '';
  const values = {
    all: [
      entry.id,
      entry.title,
      entry.ownerEmail,
      entry.ownerName,
      entry.note,
      entry.skeleton,
      entry.atlas,
      files,
      animations,
      entry.previewPath,
      entry.repositoryUrl,
    ],
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

function generatedThumbnailUrl(origin, entry) {
  const id = String(entry?.id || '').trim();
  const poster = String(entry?.thumbnailPoster || '');
  return origin && id && /^data:image\/webp;base64,/i.test(poster)
    ? appendAssetVersion(`${origin}/assets/library/${encodeURIComponent(id)}/generated-preview.webp`, assetVersionForEntry(entry, 'generated-preview'))
    : '';
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

function githubHeaders(token) {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

async function githubText(settings, path) {
  return cachedGithubText(settings, path);
}

async function githubBuffer(settings, path) {
  const encodedPath = encodeURIComponent(cleanRepoPath(path)).replace(/%2F/g, '/');
  const response = await fetch(`https://api.github.com/repos/${settings.owner}/${settings.repo}/contents/${encodedPath}?ref=${encodeURIComponent(settings.branch)}`, {
    headers: githubHeaders(settings.token),
  });
  if (!response.ok) return null;
  const data = await response.json();
  if (typeof data?.content === 'string' && data.content.trim()) {
    return Buffer.from(data.content.replace(/\s/g, ''), 'base64');
  }
  if (typeof data?.download_url === 'string' && data.download_url) {
    const rawResponse = await fetch(data.download_url, { headers: githubHeaders(settings.token) });
    if (!rawResponse.ok) return null;
    return Buffer.from(await rawResponse.arrayBuffer());
  }
  return null;
}

function compareArchiveEntries(a, b) {
  return String(b?.uploadedAt || '').localeCompare(String(a?.uploadedAt || ''));
}

function previewUrl(entry) {
  const id = encodeURIComponent(String(entry?.id || ''));
  const animation = String(entry?.defaultAnimation || '').trim();
  return animation ? `/p/${id}?animation=${encodeURIComponent(animation)}` : `/p/${id}`;
}

function archiveItemUrl(entry) {
  return `/world-spine-archive/${encodeURIComponent(String(entry?.id || ''))}`;
}

function videoWatchUrl(entry) {
  return `/video/${encodeURIComponent(String(entry?.id || ''))}`;
}

function entryHasFile(entry, fileName = '') {
  const name = String(fileName || '').trim().toLowerCase();
  return Array.isArray(entry?.files) && entry.files.some((file) => String(file || '').trim().toLowerCase() === name);
}

function sourceProofUrlForEntry(origin, entry) {
  const direct = safeAsset(entry?.sourceProofUrl || entry?.sourceProof?.proofUrl);
  if (direct) return direct;
  const path = cleanRepoPath(entry?.sourceProofPath || entry?.sourceProof?.proofPath || '');
  if (path) return `${origin}/assets/${encodeRepoPath(path)}`;
  if (entryHasFile(entry, 'source-proof.json') && entry?.previewPath) {
    return `${origin}/assets/${encodeRepoPath(`${entry.previewPath}/source-proof.json`)}`;
  }
  return '';
}

function blockchainAnchorUrlForEntry(origin, entry) {
  const direct = safeAsset(entry?.blockchainAnchor?.anchorUrl || entry?.blockchainAnchor?.github?.anchorUrl);
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

function shuffleEntries(entries) {
  return entries
    .map((entry) => ({ entry, sort: Math.random() }))
    .sort((a, b) => a.sort - b.sort)
    .map(({ entry }) => entry);
}

function feedScore(entry, metrics) {
  const metric = metricCountsForId(metrics, String(entry?.id || ''));
  const uploadedAt = Date.parse(String(entry?.uploadedAt || '')) || 0;
  const recency = uploadedAt ? Math.max(0, 60 - Math.floor((Date.now() - uploadedAt) / 86400000)) : 0;
  return metric.likes * 12 + metric.views * 3 + recency;
}

function homepageFeedEntries(origin, entries, metrics) {
  const scoredEntries = entries
    .filter((entry) => entry?.hiddenFromPublicLibrary !== true && (entry?.webmPreview || entry?.thumbnailPoster || entry?.thumbnail))
    .map((entry) => ({ entry, score: feedScore(entry, metrics) }))
    .sort((a, b) => b.score - a.score || compareArchiveEntries(a.entry, b.entry));
  const topPool = scoredEntries.slice(0, Math.min(96, Math.max(24, scoredEntries.length))).map(({ entry }) => entry);
  const randomEntries = shuffleEntries(topPool).slice(0, 32);
  return randomEntries.map((entry) => {
    const id = String(entry?.id || '');
    const metric = metricCountsForId(metrics, id);
    const isGifThumbnail = entry?.thumbnailType === 'gif' || /^data:image\/gif;base64,/i.test(String(entry?.thumbnail || ''));
    const thumbnail = isGifThumbnail ? '' : entryImageAsset(entry?.thumbnail || '', entry, 'thumbnail');
    const poster = entryImageAsset(entry?.thumbnailPoster || '', entry, 'poster') || generatedThumbnailUrl(origin, entry) || thumbnail;
    return {
      id,
      title: String(entry?.title || id || 'Spine preview'),
      ownerName: String(entry?.ownerName || 'Spine creator'),
      ownerUrl: entry?.publicOwnerId ? `${origin}/u/${encodeURIComponent(String(entry.publicOwnerId))}` : '',
      previewUrl: `${origin}${previewUrl(entry)}`,
      webmPreview: entryVideoAsset(entry?.webmPreview || '', entry, 'webm'),
      thumbnailPoster: poster,
      thumbnail,
      thumbnailType: isGifThumbnail ? 'gif' : 'image',
      previewWidth: Number(entry?.previewWidth || 0) || undefined,
      previewHeight: Number(entry?.previewHeight || 0) || undefined,
      mediaAspectRatio: Number(entry?.mediaAspectRatio || 0) || undefined,
      animations: Array.isArray(entry?.animations) ? entry.animations.length : 0,
      uploadedAt: entry?.uploadedAt || '',
      pageMode: entry?.portfolioMode === true ? 'Portfolio' : 'Library',
      metrics: metric,
    };
  });
}

function imageSizeFromBuffer(buffer) {
  if (!buffer || buffer.length < 32) return null;
  if (buffer.toString('ascii', 0, 4) === 'RIFF' && buffer.toString('ascii', 8, 12) === 'WEBP') {
    let offset = 12;
    while (offset + 8 <= buffer.length) {
      const chunkType = buffer.toString('ascii', offset, offset + 4);
      const chunkSize = buffer.readUInt32LE(offset + 4);
      const dataOffset = offset + 8;
      if (chunkType === 'VP8 ' && dataOffset + 10 <= buffer.length) {
        return { width: buffer.readUInt16LE(dataOffset + 6) & 0x3fff, height: buffer.readUInt16LE(dataOffset + 8) & 0x3fff };
      }
      if (chunkType === 'VP8L' && dataOffset + 5 <= buffer.length) {
        const bits = buffer.readUInt32LE(dataOffset + 1);
        return { width: (bits & 0x3fff) + 1, height: ((bits >> 14) & 0x3fff) + 1 };
      }
      if (chunkType === 'VP8X' && dataOffset + 10 <= buffer.length) {
        return {
          width: 1 + buffer.readUIntLE(dataOffset + 4, 3),
          height: 1 + buffer.readUIntLE(dataOffset + 7, 3),
        };
      }
      offset += 8 + chunkSize + (chunkSize % 2);
    }
  }
  if (buffer[0] === 0x89 && buffer.toString('ascii', 1, 4) === 'PNG' && buffer.length >= 24) {
    return { width: buffer.readUInt32BE(16), height: buffer.readUInt32BE(20) };
  }
  if (buffer[0] === 0xff && buffer[1] === 0xd8) {
    let offset = 2;
    while (offset + 9 < buffer.length) {
      if (buffer[offset] !== 0xff) {
        offset += 1;
        continue;
      }
      const marker = buffer[offset + 1];
      const length = buffer.readUInt16BE(offset + 2);
      if (marker >= 0xc0 && marker <= 0xc3 && offset + 8 < buffer.length) {
        return { width: buffer.readUInt16BE(offset + 7), height: buffer.readUInt16BE(offset + 5) };
      }
      offset += 2 + length;
    }
  }
  return null;
}

function repoPathFromAssetUrl(entry, value) {
  const url = String(value || '');
  const marker = '/assets/';
  const markerIndex = url.indexOf(marker);
  if (markerIndex >= 0) return decodeURIComponent(url.slice(markerIndex + marker.length).split(/[?#]/)[0]);
  const path = cleanRepoPath(entry?.thumbnailPosterPath || entry?.thumbnailPath || '');
  return path || '';
}

async function enrichArchiveEntryLayout(settings, origin, entry) {
  if (!entry || typeof entry !== 'object') return entry;
  const width = Number(entry.previewWidth || entry.thumbnailWidth || entry.mediaWidth);
  const height = Number(entry.previewHeight || entry.thumbnailHeight || entry.mediaHeight);
  if (Number.isFinite(width) && Number.isFinite(height) && width > 0 && height > 0) {
    return { ...entry, mediaAspectRatio: width / height };
  }

  const posterUrl = entryImageAsset(entry.thumbnailPoster || '', entry, 'poster') || generatedThumbnailUrl(origin, entry) || entryImageAsset(entry.thumbnail || '', entry, 'thumbnail');
  const repoPath = repoPathFromAssetUrl(entry, posterUrl);
  if (!repoPath || repoPath.includes('/generated-preview.webp')) return entry;
  const buffer = await githubBuffer(settings, repoPath);
  const size = imageSizeFromBuffer(buffer);
  return size ? { ...entry, mediaAspectRatio: size.width / size.height, mediaWidth: size.width, mediaHeight: size.height } : entry;
}

async function enrichArchiveLayout(settings, origin, entries) {
  const enriched = [];
  for (const entry of entries) enriched.push(await enrichArchiveEntryLayout(settings, origin, entry));
  return enriched;
}

function tileClassForRatio(ratio) {
  if (!Number.isFinite(ratio) || ratio <= 0) return 'tile--square';
  if (ratio >= 3.2) return 'tile--full';
  if (ratio >= 1.85) return 'tile--wide';
  if (ratio >= 1.35) return 'tile--horizontal';
  if (ratio >= 1.12) return 'tile--medium-wide';
  if (ratio <= 0.62) return 'tile--vertical';
  if (ratio <= 0.72) return 'tile--medium-narrow';
  return 'tile--square';
}

function tileClassForManualSize(size = '') {
  if (!size || size === 'auto') return '';
  return `tile--${size}`;
}

function fallbackTileClass(index = 0) {
  const fallbackSizes = [
    'tile--horizontal',
    'tile--square',
    'tile--medium-wide',
    'tile--vertical',
    'tile--large-rect',
    'tile--wide',
    'tile--medium-narrow',
    'tile--square',
  ];
  return fallbackSizes[Math.abs(index) % fallbackSizes.length];
}

function tileClassForEntry(entry, index = 0) {
  const manualClass = tileClassForManualSize(entry?.cardSize);
  const fallbackWidth = Number(entry?.previewWidth || entry?.thumbnailWidth || entry?.mediaWidth || 0);
  const fallbackHeight = Number(entry?.previewHeight || entry?.thumbnailHeight || entry?.mediaHeight || 0);
  const fallbackRatio = fallbackWidth > 0 && fallbackHeight > 0 ? fallbackWidth / fallbackHeight : 0;
  if (manualClass === 'tile--medium-narrow' && fallbackRatio >= 0.75 && fallbackRatio <= 1.15) return 'tile tile--square';
  if (manualClass) return `tile ${manualClass}`;
  const ratio = Number(entry?.mediaAspectRatio || 0) || fallbackRatio;
  return `tile ${ratio ? tileClassForRatio(ratio) : fallbackTileClass(index)}`;
}

function entryImageUrl(origin, entry) {
  const isGifThumbnail = entry?.thumbnailType === 'gif' || /^data:image\/gif;base64,/i.test(String(entry?.thumbnail || ''));
  return entryImageAsset(entry?.thumbnailPoster || '', entry, 'poster') || generatedThumbnailUrl(origin, entry) || (isGifThumbnail ? '' : entryImageAsset(entry?.thumbnail || '', entry, 'thumbnail'));
}

function mediaHtml(entry, { origin = '', posterClass = '', eagerVideo = false, altText = '', fetchpriority = '' } = {}) {
  const video = entryVideoAsset(entry?.webmPreview || '', entry, 'webm');
  const poster = entryImageAsset(entry?.thumbnailPoster || '', entry, 'poster') || generatedThumbnailUrl(origin, entry);
  const isGifThumbnail = entry?.thumbnailType === 'gif' || /^data:image\/gif;base64,/i.test(String(entry?.thumbnail || ''));
  const thumbnail = isGifThumbnail ? poster : entryImageAsset(entry?.thumbnail || '', entry, 'thumbnail');
  const alt = altText || escapeHtml(entry?.title || entry?.id || 'Spine animation preview');
  const fp = fetchpriority ? ` fetchpriority="${escapeHtml(fetchpriority)}"` : '';
  const posterAttr = poster || thumbnail ? ` poster="${escapeHtml(poster || thumbnail)}"` : '';
  if (video) {
    const videoSource = eagerVideo ? ` src="${escapeHtml(video)}" controls` : ` data-video-src="${escapeHtml(video)}"`;
    const preload = eagerVideo ? 'metadata' : 'none';
    return `<video class="${posterClass}"${posterAttr}${videoSource} muted playsinline preload="${preload}" autoplay aria-label="${alt}"${fp}></video>`;
  }
  return `<video class="${posterClass}"${posterAttr} muted playsinline preload="none" autoplay aria-label="${alt}"${fp}></video>`;
}

function baseStyles() {
  return `
      * { box-sizing: border-box; }
      * { scrollbar-width: thin; scrollbar-color: rgba(74,78,84,.72) transparent; }
      *::-webkit-scrollbar { width: 8px; height: 8px; }
      *::-webkit-scrollbar-track { background: transparent; }
      *::-webkit-scrollbar-thumb { border: 2px solid transparent; border-radius: 999px; background: rgba(74,78,84,.72); background-clip: content-box; }
      html, body { min-height: 100%; margin: 0; }
      body { color: #edf5ff; background: #050607; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      .page { width: 100%; margin: 0; padding: 20px 0 46px; overflow: hidden; }
      .top { display: grid; grid-template-columns: minmax(0, 280px) minmax(0, 1fr) auto; align-items: center; gap: 16px; margin-bottom: 8px; }
      .archive-title-block { min-width: 0; justify-self: center; text-align: center; }
      .brand { display: inline-flex; flex-wrap: nowrap; align-items: center; gap: 10px; max-width: 100%; color: #fff; text-decoration: none; font-size: clamp(26px, 4.2vw, 46px); font-weight: 950; letter-spacing: 0; line-height: .9; white-space: nowrap; }
      .brand span { display: none; }
      .archive-header-right { display: grid; justify-items: end; gap: 12px; }
      .archive-logo { display: inline-flex; align-items: center; gap: 6px; color: #f7fbff; font-family: "Trebuchet MS", Inter, ui-sans-serif, system-ui, sans-serif; font-size: clamp(30px, 4.3vw, 44px); font-weight: 500; line-height: .78; letter-spacing: .18em; text-decoration: none; text-transform: uppercase; text-shadow: 0 0 1px rgba(255,255,255,.86), 0 6px 18px rgba(0,0,0,.42); }
      .archive-logo-mark { display: inline-grid; gap: 4px; width: 16px; margin: 0 -3px 0 -5px; transform: translateY(1px); }
      .archive-logo-mark i { display: block; width: 16px; height: 7px; border-radius: 999px; background: #ff5a1f; box-shadow: 0 0 8px rgba(255,90,31,.22); }
      .archive-logo-mark i:nth-child(1) { transform: translateX(-1px); }
      .archive-logo-mark i:nth-child(2) { width: 14px; transform: translateX(2px); }
      .archive-logo-mark i:nth-child(3) { width: 12px; transform: translateX(4px); }
      .archive-logo-mark i:nth-child(4) { width: 10px; transform: translateX(6px); }
      .archive-logo-mark i:nth-child(5) { width: 8px; transform: translateX(8px); }
      .archive-logo-link { margin-left: 8px; color: #ff6a28; font-size: .72em; font-weight: 800; letter-spacing: .22em; line-height: 1; transform: translate(-15px, .18em); }
      .item-header-title { display: grid; gap: 8px; min-width: 0; }
      .item-header-title span { display: block; max-width: 100%; overflow: hidden; color: #fff; font-size: clamp(20px, 3vw, 34px); font-weight: 950; line-height: 1; text-overflow: ellipsis; white-space: nowrap; }
      .back { display: inline-flex; align-items: center; justify-content: center; min-height: 48px; padding: 0 22px; border: 1px solid rgba(179,255,64,.62); border-radius: 8px; color: #eaffc2; background: rgba(179,255,64,.1); box-shadow: 0 12px 28px rgba(0,0,0,.24), inset 0 0 18px rgba(179,255,64,.08); font-size: 17px; font-weight: 950; text-decoration: none; white-space: nowrap; }
      .back:hover { border-color: rgba(140,199,255,.78); color: #fff; background: rgba(140,199,255,.12); }
      .muted { color: rgba(237,245,255,.62); }
      @media (max-width: 700px) {
        * { scrollbar-width: none; }
        *::-webkit-scrollbar { width: 0; height: 0; display: none; }
        .page { width: 100%; padding: 18px 0 46px; }
        .top { grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 10px; }
        .archive-title-block { grid-column: 1 / -1; grid-row: 2; justify-self: center; text-align: center; }
        .archive-header-right { justify-items: end; width: auto; }
        .archive-logo { font-size: clamp(28px, 8vw, 38px); }
        .brand { gap: 10px; font-size: clamp(24px, 7vw, 38px); white-space: nowrap; }
        .item-header-title span { max-width: 100%; white-space: normal; }
      }
  `;
}

function archiveHtml({ origin, entries, exclusions, metrics }) {
  const cards = entries
    .map((entry, index) => {
      const title = escapeHtml(entry?.title || entry?.id || 'Spine preview');
      const itemUrl = previewUrl(entry);
      const archiveUrl = archiveItemUrl(entry);
      const metricId = String(entry?.id || entry?.title || '');
      const metric = metricCountsForId(metrics, metricId);
      const likes = metric.likes;
      const views = metric.views;
      const cardSizeMode = entry?.cardSize && entry.cardSize !== 'auto' ? 'manual' : 'auto';
      const entryId = escapeHtml(String(entry?.id || ''));
      const fp = index < 6 ? 'high' : '';
      return `<a class="${tileClassForEntry(entry, index)}" data-entry-id="${entryId}" data-archive-url="${escapeHtml(archiveUrl)}" data-card-size-mode="${cardSizeMode}" href="${escapeHtml(itemUrl)}" aria-label="Open ${title} in the interactive Spine player">
        <div class="tile-media">${mediaHtml(entry, { origin, fetchpriority: fp })}</div>
        <span class="tile-select-check" aria-hidden="true">✓</span>
        <div class="tile-overlay">
          <strong class="tile-title">${title}</strong>
          <span class="tile-stats" data-metric-id="${entryId}" data-metric-label="stats" aria-label="${likes} likes and ${views} views">
            <span class="tile-stat tile-like-button" data-metric-id="${entryId}" data-metric-like data-metric-current-likes="${likes}" data-metric-current-views="${views}" role="button" tabindex="0" aria-pressed="false" title="Like"><span data-metric-like-icon aria-hidden="true">♡</span><strong data-metric-likes>${likes}</strong></span>
            <span class="tile-stat" data-metric-id="${entryId}" data-metric-current-likes="${likes}" data-metric-current-views="${views}"><span aria-hidden="true">◉</span><strong data-metric-views>${views}</strong></span>
          </span>
        </div>
      </a>`;
    })
    .join('');

  const googleClientId = escapeHtml(process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID || '');
  const archiveRulesJson = JSON.stringify({
    updatedAt: exclusions?.updatedAt || '',
    updatedBy: exclusions?.updatedBy || '',
    rules: Array.isArray(exclusions?.rules) ? exclusions.rules : [],
  }).replace(/</g, '\\u003c');
  const archiveImage = entries.map((entry) => entryImageUrl(origin, entry)).find(Boolean) || `${origin}/spine-link-video-thumbnail.png`;
  const itemListElements = entries.slice(0, 24).map((entry, index) => {
    const id = String(entry?.id || '').trim();
    const itemUrl = `${origin}/world-spine-archive/${encodeURIComponent(id)}`;
    const title = cleanPublicText(entry?.title || id || 'Spine animation work', 120);
    const image = entryImageUrl(origin, entry);
    const video = entryVideoAsset(entry?.webmPreview || '', entry, 'webm');
    const work = {
      '@type': video ? 'VideoObject' : 'CreativeWork',
      '@id': `${itemUrl}${video ? '#video' : '#work'}`,
      name: title,
      url: itemUrl,
      description: cleanPublicText(entry?.note || `${title} public Spine animation work in World SPINE ARCHIVE.`, 260),
      ...(image ? { image, thumbnailUrl: video ? [image] : image } : {}),
      ...(video
        ? {
            contentUrl: video,
            embedUrl: `${origin}${previewUrl(entry)}`,
            uploadDate: isoDate(entry?.uploadedAt) || '2026-05-12T00:00:00.000Z',
            ...(durationToIso8601(entry?.previewDuration) ? { duration: durationToIso8601(entry.previewDuration) } : {}),
            ...(positiveInteger(entry?.previewWidth) ? { width: positiveInteger(entry.previewWidth) } : {}),
            ...(positiveInteger(entry?.previewHeight) ? { height: positiveInteger(entry.previewHeight) } : {}),
          }
        : {}),
    };
    return {
      '@type': 'ListItem',
      position: index + 1,
      url: itemUrl,
      name: title,
      item: work,
    };
  });
  const archiveStructuredData = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'BreadcrumbList',
        '@id': `${origin}/world-spine-archive#breadcrumb`,
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Spine-Link', item: origin },
          { '@type': 'ListItem', position: 2, name: 'World SPINE ARCHIVE', item: `${origin}/world-spine-archive` },
        ],
      },
      {
        '@type': 'CollectionPage',
        '@id': `${origin}/world-spine-archive#collection`,
        name: 'World SPINE ARCHIVE',
        url: `${origin}/world-spine-archive`,
        description:
          'World SPINE ARCHIVE is a public archive of user Spine animation works. Anyone can add a Spine animation anonymously with Create preview, or sign in with Google to publish through a public portfolio profile with likes and views. Google account profiles can be public portfolios that are searchable and appear in the showcase/archive, or private libraries that are private by default and not listed through the site or Google.',
        image: archiveImage,
        keywords:
          'spine portfolio, portfolio spine, spine animation portfolio, spine animator portfolio, world spine archive, spine library',
        mainEntity: {
          '@id': `${origin}/world-spine-archive#works`,
        },
        potentialAction: [
          {
            '@type': 'CreateAction',
            name: 'Create preview',
            target: `${origin}/?upload=work`,
          },
          {
            '@type': 'RegisterAction',
            name: 'Sign in with Google',
            target: `${origin}/?login=google`,
          },
        ],
      },
      {
        '@type': 'ItemList',
        '@id': `${origin}/world-spine-archive#works`,
        name: 'Public user Spine animation works',
        url: `${origin}/world-spine-archive`,
        numberOfItems: entries.length,
        itemListElement: itemListElements,
      },
    ],
  };

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>World SPINE ARCHIVE - Public Spine Portfolio Library</title>
    <meta name="description" content="World SPINE ARCHIVE is a public archive of user Spine animation works. Anyone can add a Spine animation anonymously with Create preview, or sign in with Google to publish through a public portfolio profile with likes and views." />
    <meta name="keywords" content="spine portfolio, portfolio spine, spine animation portfolio, spine animator portfolio, world spine archive, spine library" />
    <meta name="robots" content="index,follow,max-image-preview:large,max-video-preview:-1,max-snippet:-1" />
    <meta name="googlebot" content="index,follow,max-image-preview:large,max-video-preview:-1,max-snippet:-1" />
    <meta name="application-name" content="Spine Portfolio" />
    <meta name="theme-color" content="#000000" />
    <link rel="canonical" href="${origin}/world-spine-archive" />
    <link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin />
    <link rel="preconnect" href="https://accounts.google.com" crossorigin />
    <link rel="dns-prefetch" href="https://api.github.com" />
    <link rel="stylesheet" href="/page-transitions.css" />
    <meta property="og:type" content="website" />
    <meta property="og:title" content="World SPINE ARCHIVE - Public Spine Portfolio Library" />
    <meta property="og:description" content="Public user Spine animation works, anonymous Create preview uploads, and Google-account portfolio profiles with likes, views, showcase, and archive publishing." />
    <meta property="og:url" content="${origin}/world-spine-archive" />
    <meta property="og:site_name" content="Spine Portfolio" />
    <meta property="og:image" content="${escapeHtml(archiveImage)}" />
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="World SPINE ARCHIVE - Public Spine Portfolio Library" />
    <meta name="twitter:description" content="Public user Spine animation works, anonymous Create preview uploads, and Google-account portfolio profiles." />
    <meta name="twitter:image" content="${escapeHtml(archiveImage)}" />
    <script type="application/ld+json">${jsonScript(archiveStructuredData)}</script>
    <script src="/page-transitions.js" defer></script>
    <style>
      ${baseStyles()}
      .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(clamp(74px, 4.6vw, 96px), 1fr)); grid-auto-flow: dense; grid-auto-rows: clamp(62px, 3.7vw, 78px); gap: 10px; width: 100%; margin: 0; }
      .archive-copy { max-width: min(680px, 74vw); margin: 0 auto 8px; color: rgba(237,245,255,.38); font-size: 9px; font-weight: 500; line-height: 1.02; text-align: left; }
      .tile { position: relative; min-height: 0; overflow: hidden; border: 1px solid rgba(140,199,255,.18); border-radius: 8px; color: inherit; background: #090b0d; text-decoration: none; }
      body.is-archive-selecting .tile { cursor: pointer; }
      body.is-archive-selecting .tile:hover { border-color: rgba(255,214,96,.78); }
      .tile.is-selected { border-color: rgba(179,255,64,.92); box-shadow: 0 0 0 2px rgba(179,255,64,.42), 0 18px 60px rgba(179,255,64,.12); }
      .tile-select-check { position: absolute; right: 10px; bottom: 10px; z-index: 4; display: grid; place-items: center; width: 34px; height: 34px; border: 1px solid rgba(179,255,64,.72); border-radius: 999px; color: #071009; background: #b3ff40; font-size: 18px; font-weight: 950; opacity: 0; transform: scale(.82); transition: opacity 140ms ease, transform 140ms ease; pointer-events: none; }
      body.is-archive-selecting .tile-select-check { opacity: .42; }
      body.is-archive-selecting .tile.is-selected .tile-select-check { opacity: 1; transform: scale(1); }
      .tile--small-square { grid-column: span 2; grid-row: span 2; }
      .tile--square { grid-column: span 3; grid-row: span 3; }
      .tile--horizontal { grid-column: span 4; grid-row: span 2; }
      .tile--wide { grid-column: span 6; grid-row: span 2; }
      .tile--vertical { grid-column: span 2; grid-row: span 7; }
      .tile--medium-narrow { grid-column: span 2; grid-row: span 3; }
      .tile--medium-wide { grid-column: span 4; grid-row: span 3; }
      .tile--large-rect { grid-column: span 4; grid-row: span 4; }
      .tile--full { grid-column: 1 / -1; grid-row: span 3; }
      .tile:hover { border-color: rgba(179,255,64,.68); }
      .tile-media, .tile-media img, .tile-media video { position: absolute; inset: 0; width: 100%; height: 100%; }
      .tile-media img, .tile-media video { object-fit: contain; transform: none; background: #050607; }
      .tile::after { content: ""; position: absolute; inset: 0; z-index: 1; background: linear-gradient(180deg, rgba(0,0,0,.72), rgba(0,0,0,.12) 35%, rgba(0,0,0,.22)); pointer-events: none; }
      .tile-overlay { position: absolute; top: 10px; right: 10px; left: 10px; z-index: 2; display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: center; gap: 10px; }
      .tile-title { min-width: 0; overflow: hidden; color: #fff; font-size: 14px; font-weight: 950; text-overflow: ellipsis; text-shadow: 0 2px 14px rgba(0,0,0,.86); white-space: nowrap; }
      .tile-stats { display: inline-flex; align-items: center; gap: 6px; min-width: 0; }
      .tile-stat { display: inline-flex; align-items: center; gap: 4px; min-height: 26px; padding: 0 8px; border: 1px solid rgba(255,255,255,.14); border-radius: 999px; color: rgba(237,245,255,.9); background: rgba(5,7,9,.58); box-shadow: 0 10px 24px rgba(0,0,0,.22); font-size: 12px; font-weight: 900; line-height: 1; backdrop-filter: blur(10px); }
      .tile-stat:first-child { color: #ffd6e7; border-color: rgba(255,185,214,.24); }
      .tile-stat strong { color: currentColor; font-size: 12px; line-height: 1; }
      .tile-like-button { cursor: pointer; user-select: none; }
      .tile-like-button.is-liked { border-color: rgba(255,118,171,.78); color: #ff76ab; background: rgba(255,118,171,.16); }
      .media-fallback { display: grid; place-items: center; width: 100%; height: 100%; color: #fff; font-size: 60px; font-weight: 950; background: radial-gradient(circle, rgba(140,199,255,.15), rgba(0,0,0,.92)); }
      .archive-select-control { display: grid; justify-items: end; gap: 8px; pointer-events: none; }
      .archive-select-actions { display: flex; justify-content: flex-end; gap: 8px; pointer-events: auto; }
      .archive-select-control button { min-width: 92px; min-height: 42px; padding: 0 16px; border: 1px solid rgba(179,255,64,.58); border-radius: 8px; color: #eaffc2; background: rgba(7,10,12,.84); font-weight: 950; cursor: pointer; backdrop-filter: blur(10px); pointer-events: auto; }
      .archive-select-control button.is-save { color: #071009; background: #b3ff40; }
      .archive-select-control button.is-delete { border-color: rgba(255,87,87,.72); color: #fff; background: rgba(148,22,22,.88); }
      .archive-select-control button:disabled { cursor: wait; opacity: .7; }
      .archive-select-status { max-width: min(420px, calc(100vw - 28px)); min-height: 18px; padding: 6px 9px; border-radius: 7px; color: rgba(237,245,255,.78); background: rgba(7,10,12,.78); font-size: 12px; line-height: 1.35; text-align: right; pointer-events: none; backdrop-filter: blur(10px); }
      @media (max-width: 1024px) {
        .archive-copy { max-width: min(680px, 74vw); margin-bottom: 8px; font-size: 9px; }
        .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); grid-auto-rows: 92px; gap: 8px; }
        .tile, .tile--small-square, .tile--square, .tile--horizontal, .tile--wide, .tile--vertical, .tile--medium-narrow, .tile--medium-wide, .tile--large-rect, .tile--full { grid-column: 1 / -1; grid-row: span 3; }
        .tile-overlay { grid-template-columns: 1fr; align-items: start; gap: 8px; }
        .tile-stats { justify-self: start; }
      }
    </style>
    ${googleClientId ? '<script src="https://accounts.google.com/gsi/client" async defer></script>' : ''}
  </head>
  <body>
    <main class="page">
      <header class="top">
        <a class="archive-logo" href="/" aria-label="Spine-Link home">
          <span>s</span><span>p</span><span class="archive-logo-mark" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span><span>n</span><span>e</span><span class="archive-logo-link">link</span>
        </a>
        <div class="archive-title-block">
          <h1 class="brand"><span>Public user Spine works</span>World ARCHIVE</h1>
        </div>
        <div class="archive-header-right">
          <a class="back" href="/">Create preview</a>
        </div>
      </header>
      <p class="archive-copy">
        Browse public <a href="/spine-animations.html" style="color:inherit">Spine animation</a> works from the worldwide archive.
        Anyone can <a href="/?upload=work" style="color:inherit">add a Spine animation</a> anonymously with
        <a href="/?upload=work" style="color:inherit">Create preview</a>, or <a href="/?login=google" style="color:inherit">sign in with Google</a>
        and publish through a <a href="/spine-portfolio.html" style="color:inherit">Spine portfolio</a> profile.
        <a href="/spine-portfolio.html" style="color:inherit">Portfolio profiles</a> are public,
        searchable, and show likes and views; <a href="/spine-library.html" style="color:inherit">library profiles</a> are private by default
        and are not listed through the site or Google unlike portfolios.
      </p>
      ${entries.length ? `<section class="grid">${cards}</section>` : '<p class="muted">No public previews yet.</p>'}
      <footer class="archive-footer">
        <div class="archive-select-control" aria-live="polite">
          <div class="archive-select-actions">
            <button type="button" id="archive-select-button">Select</button>
            <button type="button" class="is-delete" id="archive-delete-button" hidden>Delete</button>
          </div>
          <div class="archive-select-status" id="archive-select-status"></div>
        </div>
      </footer>
    </main>
    <script>window.SpineLinkMetricsConfig = {};</script>
    <script src="/spine-metrics.js" defer></script>
    <script>
      const archiveRulesState = ${archiveRulesJson};
      const archiveGoogleClientId = "${googleClientId}";
      let archiveGoogleToken = "";
      let archiveSelectMode = false;
      let archivePendingAction = "";
      let archiveBusy = false;
      const archiveSelectedIds = new Set();
      const archiveSelectButton = document.getElementById("archive-select-button");
      const archiveDeleteButton = document.getElementById("archive-delete-button");
      const archiveStatus = document.getElementById("archive-select-status");
      function setArchiveStatus(message) {
        if (archiveStatus) archiveStatus.textContent = message || "";
      }
      function escapeRegex(value) {
        const specialCodes = new Set([92, 94, 36, 46, 124, 63, 42, 43, 40, 41, 91, 93, 123, 125]);
        return String(value || "").split("").map((character) => specialCodes.has(character.charCodeAt(0)) ? String.fromCharCode(92) + character : character).join("");
      }
      function selectedRuleForId(id) {
        return { enabled: true, type: "regex", field: "id", pattern: "^" + escapeRegex(id) + "$", flags: "i" };
      }
      function updateSelectUi() {
        document.body.classList.toggle("is-archive-selecting", archiveSelectMode);
        archiveSelectButton.textContent = archiveSelectMode ? "Save" : "Select";
        archiveSelectButton.classList.toggle("is-save", archiveSelectMode);
        archiveSelectButton.disabled = archiveBusy;
        if (archiveDeleteButton) {
          archiveDeleteButton.hidden = !archiveSelectMode;
          archiveDeleteButton.disabled = archiveBusy;
        }
        document.querySelectorAll(".tile").forEach((tile) => {
          const selected = archiveSelectedIds.has(tile.dataset.entryId || "");
          tile.classList.toggle("is-selected", selected);
          tile.setAttribute("aria-selected", String(selected));
        });
        if (archiveSelectMode) {
          setArchiveStatus(archiveSelectedIds.size ? archiveSelectedIds.size + " selected" : "Choose cards to hide from this archive page.");
        } else {
          setArchiveStatus("");
        }
      }
      function requestArchiveSignIn() {
        if (!archiveGoogleClientId || !window.google?.accounts?.oauth2) {
          setArchiveStatus("Google sign in is not configured.");
          return;
        }
        const client = window.google.accounts.oauth2.initTokenClient({
          client_id: archiveGoogleClientId,
          scope: "openid email profile",
          callback: (response) => {
            archiveGoogleToken = response.access_token || "";
            if (!archiveGoogleToken) {
              setArchiveStatus("Google sign in failed.");
              return;
            }
            const pendingAction = archivePendingAction;
            archivePendingAction = "";
            if (pendingAction === "delete") {
              deleteArchiveSelection();
            } else if (pendingAction === "save") {
              saveArchiveSelection();
            } else {
              setArchiveStatus("Signed in. Press Save.");
            }
          },
        });
        client.requestAccessToken({ prompt: archiveGoogleToken ? "" : "consent" });
      }
      async function saveArchiveSelection() {
        if (!archiveSelectedIds.size) {
          setArchiveStatus("Select at least one card.");
          return;
        }
        if (!archiveGoogleToken) {
          archivePendingAction = "save";
          setArchiveStatus("Sign in with Google to save.");
          requestArchiveSignIn();
          return;
        }
        archiveBusy = true;
        updateSelectUi();
        setArchiveStatus("Saving selection...");
        try {
          const currentRules = (Array.isArray(archiveRulesState.rules) ? archiveRulesState.rules : []).map((rule) => ({
            enabled: rule.enabled !== false,
            type: rule.type === "regex" ? "regex" : "contains",
            field: rule.field || "all",
            pattern: String(rule.pattern || "").trim(),
            flags: String(rule.flags || "i").trim() || "i",
          })).filter((rule) => rule.pattern);
          const existingKeys = new Set(currentRules.map((rule) => [rule.type, rule.field, rule.pattern, rule.flags].join("\\n")));
          const rules = currentRules.slice();
          Array.from(archiveSelectedIds).forEach((id) => {
            const rule = selectedRuleForId(id);
            const key = [rule.type, rule.field, rule.pattern, rule.flags].join("\\n");
            if (!existingKeys.has(key)) {
              existingKeys.add(key);
              rules.push(rule);
            }
          });
          const result = await fetch("/api/github-upload", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: "Bearer " + archiveGoogleToken },
            body: JSON.stringify({ action: "update-archive-exclusions", rules, commitPrefix: "Hide selected World SPINE ARCHIVE cards" }),
          });
          const payload = await result.json().catch(() => ({}));
          if (!result.ok) throw new Error(payload.error || "Could not save rules.");
          setArchiveStatus("Saved. Refreshing...");
          window.location.reload();
        } catch (error) {
          setArchiveStatus(error instanceof Error ? error.message : "Could not save selection.");
        } finally {
          archiveBusy = false;
          updateSelectUi();
        }
      }
      async function deleteArchiveSelection() {
        if (!archiveSelectedIds.size) {
          setArchiveStatus("Select at least one card.");
          return;
        }
        if (!archiveGoogleToken) {
          archivePendingAction = "delete";
          setArchiveStatus("Sign in with Google to delete.");
          requestArchiveSignIn();
          return;
        }
        const selectedIds = Array.from(archiveSelectedIds);
        const confirmed = window.confirm("Delete " + selectedIds.length + " selected cards from the archive index?");
        if (!confirmed) {
          setArchiveStatus(selectedIds.length + " selected");
          return;
        }
        archiveBusy = true;
        updateSelectUi();
        setArchiveStatus("Deleting selected cards...");
        try {
          const result = await fetch("/api/github-upload", {
            method: "POST",
            headers: { "Content-Type": "application/json", Authorization: "Bearer " + archiveGoogleToken },
            body: JSON.stringify({ action: "delete-archive-entries", entryIds: selectedIds, commitPrefix: "Delete selected World SPINE ARCHIVE cards" }),
          });
          const payload = await result.json().catch(() => ({}));
          if (!result.ok) throw new Error(payload.error || "Could not delete selected cards.");
          setArchiveStatus("Deleted " + (Array.isArray(payload.deleted) ? payload.deleted.length : selectedIds.length) + ". Refreshing...");
          window.location.reload();
        } catch (error) {
          setArchiveStatus(error instanceof Error ? error.message : "Could not delete selected cards.");
        } finally {
          archiveBusy = false;
          updateSelectUi();
        }
      }
      document.querySelectorAll(".tile").forEach((tile) => {
        tile.addEventListener("click", (event) => {
          if (!archiveSelectMode) return;
          event.preventDefault();
          const id = tile.dataset.entryId || "";
          if (!id) return;
          if (archiveSelectedIds.has(id)) archiveSelectedIds.delete(id);
          else archiveSelectedIds.add(id);
          updateSelectUi();
        });
      });
      archiveSelectButton?.addEventListener("click", () => {
        if (!archiveSelectMode) {
          archiveSelectMode = true;
          updateSelectUi();
          return;
        }
        saveArchiveSelection();
      });
      archiveDeleteButton?.addEventListener("click", () => {
        deleteArchiveSelection();
      });
      updateSelectUi();
      function tileClassForAspectRatio(ratio) {
        if (!Number.isFinite(ratio) || ratio <= 0) return "tile--square";
        if (ratio >= 3.2) return "tile--full";
        if (ratio >= 1.85) return "tile--wide";
        if (ratio >= 1.35) return "tile--horizontal";
        if (ratio >= 1.12) return "tile--medium-wide";
        if (ratio <= 0.62) return "tile--vertical";
        if (ratio <= 0.72) return "tile--medium-narrow";
        return "tile--square";
      }
      function mediaContentAspectRatio(video) {
        if (!video.videoWidth || !video.videoHeight || video.readyState < 2) return 0;
        const canvas = document.createElement("canvas");
        canvas.width = video.videoWidth;
        canvas.height = video.videoHeight;
        const context = canvas.getContext("2d", { willReadFrequently: true });
        if (!context) return 0;
        try {
          context.drawImage(video, 0, 0, canvas.width, canvas.height);
          const image = context.getImageData(0, 0, canvas.width, canvas.height);
          const data = image.data;
          const sample = Math.max(2, Math.min(16, Math.floor(Math.min(image.width, image.height) / 8)));
          let red = 0, green = 0, blue = 0, alpha = 0, count = 0;
          function add(x, y) {
            const index = (y * image.width + x) * 4;
            red += data[index]; green += data[index + 1]; blue += data[index + 2]; alpha += data[index + 3]; count += 1;
          }
          for (let y = 0; y < sample; y += 1) {
            for (let x = 0; x < sample; x += 1) {
              add(x, y); add(image.width - 1 - x, y); add(x, image.height - 1 - y); add(image.width - 1 - x, image.height - 1 - y);
            }
          }
          const bg = [red / count, green / count, blue / count, alpha / count];
          const bgLuma = bg[0] * 0.2126 + bg[1] * 0.7152 + bg[2] * 0.0722;
          let minX = image.width, minY = image.height, maxX = -1, maxY = -1;
          for (let y = 0; y < image.height; y += 1) {
            for (let x = 0; x < image.width; x += 1) {
              const index = (y * image.width + x) * 4;
              const r = data[index], g = data[index + 1], b = data[index + 2], a = data[index + 3];
              const rgbDistance = Math.abs(r - bg[0]) + Math.abs(g - bg[1]) + Math.abs(b - bg[2]);
              const alphaDistance = Math.abs(a - bg[3]);
              const luma = r * 0.2126 + g * 0.7152 + b * 0.0722;
              const chroma = Math.max(r, g, b) - Math.min(r, g, b);
              const isTransparentContent = bg[3] < 32 ? a > 18 : alphaDistance > 80;
              const isVisibleVideoContent = a > 12 && rgbDistance > 72 && (luma > bgLuma + 24 || chroma > 28 || rgbDistance > 120);
              if (isTransparentContent || isVisibleVideoContent) {
                minX = Math.min(minX, x); minY = Math.min(minY, y); maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
              }
            }
          }
          if (maxX < minX || maxY < minY) return 0;
          return (maxX - minX + 1) / (maxY - minY + 1);
        } catch {
          return 0;
        }
      }
      function selectedVideoAspectRatio(video) {
        return video.videoWidth && video.videoHeight ? video.videoWidth / video.videoHeight : 0;
      }
      function applyArchiveVideoAspectClass(video) {
        const tile = video.closest(".tile");
        if (!tile || !video.videoWidth || !video.videoHeight) return;
        if (tile.dataset.cardSizeMode === "manual") return;
        tile.classList.remove(
          "tile--small-square",
          "tile--square",
          "tile--horizontal",
          "tile--wide",
          "tile--vertical",
          "tile--medium-narrow",
          "tile--medium-wide",
          "tile--large-rect",
          "tile--full"
        );
        tile.classList.add(tileClassForAspectRatio(selectedVideoAspectRatio(video)));
      }
      document.querySelectorAll(".tile video").forEach((video) => {
        video.addEventListener("loadedmetadata", () => applyArchiveVideoAspectClass(video));
      });
      function playArchiveVideo(video) {
        const source = video.dataset.videoSrc || video.getAttribute("src") || "";
        if (!source) return;
        if (!video.getAttribute("src")) video.setAttribute("src", source);
        video.muted = true;
        video.loop = true;
        video.playsInline = true;
        try { video.currentTime = 0; } catch {}
        video.play().catch(() => {});
      }
      function stopArchiveVideo(video) {
        video.pause();
        video.onended = null;
        try { video.currentTime = 0; } catch {}
      }
      function getArchiveActiveLimit() {
        return window.matchMedia("(max-width: 1024px), (pointer: coarse)").matches ? 1 : 2;
      }
      function installArchiveViewportAutoplay() {
        const visibleTiles = new Set();
        const manualTiles = new WeakSet();
        const hoverTimers = new WeakMap();
        function clearHoverTimer(tile) {
          const timer = hoverTimers.get(tile);
          if (timer) window.clearTimeout(timer);
          hoverTimers.delete(tile);
        }
        function startHoverLoop(tile) {
          manualTiles.add(tile);
          clearHoverTimer(tile);
          const video = tile.querySelector("video");
          if (!video) return;
          video.onended = () => {
            const timer = window.setTimeout(() => {
              if (!manualTiles.has(tile)) return;
              try { video.currentTime = 0; } catch {}
              playArchiveVideo(video);
            }, 1000);
            hoverTimers.set(tile, timer);
          };
          playArchiveVideo(video);
        }
        function stopHoverLoop(tile) {
          manualTiles.delete(tile);
          clearHoverTimer(tile);
          const video = tile.querySelector("video");
          if (video) stopArchiveVideo(video);
        }
        function updateAutoplay() {
          const tiles = Array.from(visibleTiles).filter((tile) => tile.isConnected);
          if (!tiles.length) return;
          const activeLimit = Math.min(getArchiveActiveLimit(), tiles.length);
          const activeTiles = new Set();
          tiles.forEach((tile) => {
            const video = tile.querySelector("video");
            if (!video || !(video.dataset.videoSrc || video.getAttribute("src"))) return;
            if (manualTiles.has(tile) || (tile.matches(":hover") || tile.matches(":focus-within"))) {
              activeTiles.add(tile);
            }
          });
          const remaining = activeLimit - activeTiles.size;
          if (remaining > 0) {
            const candidates = tiles.filter((tile) => !activeTiles.has(tile) && !manualTiles.has(tile));
            for (const tile of candidates.slice(0, remaining)) {
              activeTiles.add(tile);
            }
          }
          tiles.forEach((tile) => {
            const video = tile.querySelector("video");
            if (!video) return;
            const shouldPlay = activeTiles.has(tile) && !video.paused;
            const shouldPause = !activeTiles.has(tile) && !video.paused;
            if (shouldPause) stopArchiveVideo(video);
            else if (shouldPlay && video.paused) playArchiveVideo(video);
          });
        }
        document.querySelectorAll(".tile").forEach((tile) => {
          const video = tile.querySelector("video");
          if (!video) return;
          tile.addEventListener("pointerenter", () => startHoverLoop(tile));
          tile.addEventListener("focusin", () => startHoverLoop(tile));
          tile.addEventListener("pointerleave", () => stopHoverLoop(tile));
          tile.addEventListener("focusout", () => stopHoverLoop(tile));
        });
        if ("IntersectionObserver" in window) {
          const observer = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
              if (entry.isIntersecting && entry.intersectionRatio >= 0.35) {
                visibleTiles.add(entry.target);
              } else {
                visibleTiles.delete(entry.target);
                if (!manualTiles.has(entry.target)) {
                  const video = entry.target.querySelector("video");
                  if (video) stopArchiveVideo(video);
                }
              }
            });
            updateAutoplay();
          }, { threshold: [0, 0.35, 0.7, 1] });
          document.querySelectorAll(".tile").forEach((tile) => observer.observe(tile));
        } else {
          document.querySelectorAll(".tile").forEach((tile) => visibleTiles.add(tile));
        }
        document.addEventListener("visibilitychange", () => {
          if (document.hidden) {
            visibleTiles.forEach((tile) => {
              if (!manualTiles.has(tile)) {
                const video = tile.querySelector("video");
                if (video) stopArchiveVideo(video);
              }
            });
          } else {
            updateAutoplay();
          }
        });
        window.addEventListener("pagehide", () => {
          visibleTiles.forEach((tile) => {
            const video = tile.querySelector("video");
            if (video) stopArchiveVideo(video);
          });
        }, { once: true });
        updateAutoplay();
      }
      installArchiveViewportAutoplay();
    </script>
  </body>
</html>`;
}

function archiveItemHtml({ origin, entry, metrics }) {
  const rawTitle = cleanPublicText(entry?.title || entry?.id || 'Spine preview', 120);
  const title = escapeHtml(rawTitle);
  const animations = Array.isArray(entry?.animations) ? entry.animations.length : 0;
  const spineUrl = previewUrl(entry);
  const absoluteSpineUrl = `${origin}${spineUrl}`;
  const entryId = String(entry?.id || '');
  const safeEntryId = escapeHtml(entryId);
  const metric = metricCountsForId(metrics, entryId);
  const pageUrl = `${origin}/world-spine-archive/${encodeURIComponent(entryId)}`;
  const videoPageUrl = `${origin}${videoWatchUrl(entry)}`;
  const playerPageUrl = absoluteSpineUrl;
  const mediaImage = entryImageUrl(origin, entry) || `${origin}/spine-link-video-thumbnail.png`;
  const mediaVideo = entryVideoAsset(entry?.webmPreview || '', entry, 'webm');
  const ownerName = cleanPublicText(entry?.ownerName || 'Spine creator', 100);
  const description = cleanPublicText(
    entry?.note ||
      `${rawTitle} is a public Spine animation work in World SPINE ARCHIVE. Open the interactive Spine player, watch the WebM preview, and view real likes and views on Spine Portfolio.`,
    280,
  );
  const uploadedAt = isoDate(entry?.uploadedAt) || '2026-05-12T00:00:00.000Z';
  const proofDocuments = proofDocumentsForEntry(origin, entry, pageUrl);
  const sourceProofUrl = sourceProofUrlForEntry(origin, entry);
  const blockchainAnchorUrl = blockchainAnchorUrlForEntry(origin, entry);
  const proofHash = sanitizeSha256(entry?.sourceProof?.proofHash || entry?.blockchainAnchor?.sourceProofHash);
  const anchorHash = sanitizeSha256(entry?.blockchainAnchor?.anchorHash);
  const workStructuredData = mediaVideo
    ? {
        '@type': 'VideoObject',
        '@id': `${pageUrl}#video`,
        name: rawTitle,
        description,
        thumbnailUrl: [mediaImage],
        contentUrl: mediaVideo,
        embedUrl: playerPageUrl,
        url: playerPageUrl,
        mainEntityOfPage: playerPageUrl,
        uploadDate: uploadedAt,
        isFamilyFriendly: true,
        ...(durationToIso8601(entry?.previewDuration) ? { duration: durationToIso8601(entry.previewDuration) } : {}),
        ...(positiveInteger(entry?.previewWidth) ? { width: positiveInteger(entry.previewWidth) } : {}),
        ...(positiveInteger(entry?.previewHeight) ? { height: positiveInteger(entry.previewHeight) } : {}),
        ...(proofDocuments.length ? { subjectOf: proofDocuments.map((document) => ({ '@id': document['@id'] })) } : {}),
        interactionStatistic: [
          {
            '@type': 'InteractionCounter',
            interactionType: { '@type': 'LikeAction' },
            userInteractionCount: metric.likes,
          },
          {
            '@type': 'InteractionCounter',
            interactionType: { '@type': 'WatchAction' },
            userInteractionCount: metric.views,
          },
        ],
        creator: {
          '@type': 'Person',
          name: ownerName,
        },
        publisher: {
          '@type': 'Organization',
          name: 'Spine Portfolio',
          alternateName: 'Spine-Link',
          url: origin,
          logo: {
            '@type': 'ImageObject',
            url: `${origin}/favicon-64.png`,
            width: 64,
            height: 64,
          },
        },
        potentialAction: {
          '@type': 'WatchAction',
          target: playerPageUrl,
        },
      }
    : {
        '@type': 'CreativeWork',
        '@id': `${pageUrl}#work`,
        name: rawTitle,
        description,
        image: mediaImage,
        url: pageUrl,
        datePublished: uploadedAt,
        ...(proofDocuments.length ? { subjectOf: proofDocuments.map((document) => ({ '@id': document['@id'] })) } : {}),
        creator: {
          '@type': 'Person',
          name: ownerName,
        },
      };
  const itemStructuredData = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebPage',
        '@id': `${pageUrl}#webpage`,
        name: `${rawTitle} - World SPINE ARCHIVE`,
        description,
        url: pageUrl,
        isPartOf: {
          '@type': 'CollectionPage',
          '@id': `${origin}/world-spine-archive#collection`,
          name: 'World SPINE ARCHIVE',
          url: `${origin}/world-spine-archive`,
        },
        primaryImageOfPage: {
          '@type': 'ImageObject',
          url: mediaImage,
        },
        mainEntity: {
          '@id': workStructuredData['@id'],
        },
      },
      workStructuredData,
      ...proofDocuments,
      {
        '@type': 'BreadcrumbList',
        '@id': `${pageUrl}#breadcrumbs`,
        itemListElement: [
          {
            '@type': 'ListItem',
            position: 1,
            name: 'Spine Portfolio',
            item: origin,
          },
          {
            '@type': 'ListItem',
            position: 2,
            name: 'World SPINE ARCHIVE',
            item: `${origin}/world-spine-archive`,
          },
          {
            '@type': 'ListItem',
            position: 3,
            name: rawTitle,
            item: pageUrl,
          },
        ],
      },
    ],
  };
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title} - World SPINE ARCHIVE</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <meta name="robots" content="index,follow,max-image-preview:large,max-video-preview:-1,max-snippet:-1" />
    <meta name="googlebot" content="index,follow,max-image-preview:large,max-video-preview:-1,max-snippet:-1" />
    <meta name="application-name" content="Spine Portfolio" />
    <meta name="theme-color" content="#000000" />
    <meta name="referrer" content="strict-origin-when-cross-origin" />
    <link rel="canonical" href="${escapeHtml(pageUrl)}" />
    <link rel="alternate" href="${escapeHtml(playerPageUrl)}" title="${title} interactive Spine player video page" />
    ${mediaVideo ? `<link rel="alternate" href="${escapeHtml(videoPageUrl)}" title="${title} dedicated WebM watch page" />` : ''}
    <link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin />
    <link rel="preconnect" href="https://accounts.google.com" crossorigin />
    <link rel="dns-prefetch" href="https://api.github.com" />
    <link rel="stylesheet" href="/page-transitions.css" />
    <meta property="og:type" content="${mediaVideo ? 'video.other' : 'article'}" />
    <meta property="og:title" content="${title} - World SPINE ARCHIVE" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:url" content="${escapeHtml(pageUrl)}" />
    <meta property="og:site_name" content="Spine Portfolio" />
    <meta property="og:image" content="${escapeHtml(mediaImage)}" />${mediaVideo ? `
    <meta property="og:video" content="${escapeHtml(mediaVideo)}" />
    <meta property="og:video:secure_url" content="${escapeHtml(mediaVideo)}" />
    <meta property="og:video:type" content="video/webm" />` : ''}
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${title} - World SPINE ARCHIVE" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${escapeHtml(mediaImage)}" />
    <script type="application/ld+json">${jsonScript(itemStructuredData)}</script>
    <script src="/page-transitions.js" defer></script>
    <style>
      ${baseStyles()}
      .viewer { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 18px; align-items: stretch; }
      .media-panel { min-height: min(74vh, 760px); overflow: hidden; border: 1px solid rgba(140,199,255,.2); border-radius: 8px; background: #050607; }
      .media-panel img, .media-panel video { width: 100%; height: 100%; min-height: min(74vh, 760px); object-fit: contain; background: #050607; }
      .side { display: flex; flex-direction: column; justify-content: space-between; gap: 18px; padding: 18px; border: 1px solid rgba(255,255,255,.1); border-radius: 8px; background: rgba(255,255,255,.045); }
      .metric-row { display: flex; flex-wrap: wrap; gap: 8px; }
      .metric-pill { display: inline-flex; align-items: center; gap: 7px; min-height: 38px; padding: 0 12px; border: 1px solid rgba(255,255,255,.14); border-radius: 999px; color: rgba(237,245,255,.9); background: rgba(5,7,9,.58); font-weight: 950; }
      .metric-pill strong { color: currentColor; font-size: 13px; }
      .metric-like-button { border-color: rgba(255,185,214,.32); color: #ffe4ef; cursor: pointer; user-select: none; }
      .metric-like-button.is-liked { border-color: rgba(255,118,171,.78); color: #ff76ab; background: rgba(255,118,171,.16); }
      .visually-hidden { position: absolute; width: 1px; height: 1px; overflow: hidden; clip-path: inset(50%); white-space: nowrap; pointer-events: none; }
      .item-title { margin: 0 0 8px; font-size: clamp(30px, 5vw, 56px); line-height: .95; }
      .spine-link { display: inline-flex; justify-content: center; align-items: center; min-height: 48px; padding: 0 16px; border: 1px solid rgba(179,255,64,.72); border-radius: 8px; color: #eaffc2; font-weight: 900; text-decoration: none; background: rgba(179,255,64,.12); }
      .proof-panel { display: grid; gap: 10px; padding-top: 12px; border-top: 1px solid rgba(255,255,255,.1); }
      .proof-panel a { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-height: 38px; padding: 0 10px; border: 1px solid rgba(140,199,255,.2); border-radius: 8px; color: #dff1ff; background: rgba(140,199,255,.08); font-size: 12px; font-weight: 850; text-decoration: none; }
      .proof-panel a:hover { border-color: rgba(179,255,64,.58); color: #fff; }
      .proof-panel code { overflow: hidden; max-width: 148px; color: rgba(237,245,255,.68); font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 10px; text-overflow: ellipsis; white-space: nowrap; }
      @media (max-width: 860px) { .viewer { grid-template-columns: 1fr; } .media-panel, .media-panel img, .media-panel video { min-height: 58vh; } }
    </style>
  </head>
  <body>
    <main class="page">
      <header class="top">
        <a class="archive-logo" href="/" aria-label="Spine-Link home">
          <span>s</span><span>p</span><span class="archive-logo-mark" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span><span>n</span><span>e</span><span class="archive-logo-link">link</span>
        </a>
        <div class="item-header-title">
          <a class="back" href="/world-spine-archive">World SPINE ARCHIVE</a>
          <span>${title}</span>
        </div>
        <div class="archive-header-right">
          <a class="back" href="/">Create preview</a>
        </div>
      </header>
      <section class="viewer">
        <h1 class="visually-hidden">${title} — World SPINE ARCHIVE</h1>
        <div class="media-panel">${mediaHtml(entry, { origin, posterClass: 'media-main', eagerVideo: true })}</div>
        <div class="side">
          <div>
            <p class="muted">Spine media preview</p>
            <h2 class="item-title">${title}</h2>
            <p class="muted">${animations} animations</p>
            <div class="metric-row" data-metric-id="${safeEntryId}" data-metric-label="stats" aria-label="${metric.likes} likes and ${metric.views} views">
              <span class="metric-pill metric-like-button" data-metric-id="${safeEntryId}" data-metric-like data-metric-current-likes="${metric.likes}" data-metric-current-views="${metric.views}" role="button" tabindex="0" aria-pressed="false" title="Like"><span data-metric-like-icon aria-hidden="true">♡</span><strong data-metric-likes>${metric.likes}</strong></span>
              <span class="metric-pill" data-metric-id="${safeEntryId}" data-metric-current-likes="${metric.likes}" data-metric-current-views="${metric.views}"><span aria-hidden="true">◉</span><strong data-metric-views>${metric.views}</strong></span>
            </div>
          </div>
          ${sourceProofUrl || blockchainAnchorUrl ? `<div class="proof-panel">
            <p class="muted">Origin proof</p>
            ${sourceProofUrl ? `<a href="${escapeHtml(sourceProofUrl)}" target="_blank" rel="noreferrer">source-proof.json${proofHash ? `<code>${escapeHtml(shortHash(proofHash))}</code>` : ''}</a>` : ''}
            ${blockchainAnchorUrl ? `<a href="${escapeHtml(blockchainAnchorUrl)}" target="_blank" rel="noreferrer">blockchain-anchor.json${anchorHash ? `<code>${escapeHtml(shortHash(anchorHash))}</code>` : ''}</a>` : ''}
          </div>` : ''}
          <a class="spine-link" href="${spineUrl}">Open interactive Spine player</a>
          ${mediaVideo ? `<a class="spine-link" href="${videoWatchUrl(entry)}">Dedicated WebM page</a>` : ''}
        </div>
      </section>
    </main>
    <script>window.SpineLinkMetricsConfig = { viewId: ${JSON.stringify(entryId)} };</script>
    <script src="/spine-metrics.js" defer></script>
  </body>
</html>`;
}

function archiveVideoHtml({ origin, entry, metrics }) {
  const rawTitle = cleanPublicText(entry?.title || entry?.id || 'Spine animation video', 120);
  const title = escapeHtml(rawTitle);
  const entryId = String(entry?.id || '');
  const safeEntryId = escapeHtml(entryId);
  const metric = metricCountsForId(metrics, entryId);
  const pageUrl = `${origin}${videoWatchUrl(entry)}`;
  const archivePageUrl = `${origin}${archiveItemUrl(entry)}`;
  const playerPageUrl = `${origin}${previewUrl(entry)}`;
  const mediaImage = entryImageUrl(origin, entry) || `${origin}/spine-link-video-thumbnail.png`;
  const mediaVideo = entryVideoAsset(entry?.webmPreview || '', entry, 'webm');
  const ownerName = cleanPublicText(entry?.ownerName || 'Spine creator', 100);
  const description = cleanPublicText(
    entry?.note ||
      `${rawTitle} is a dedicated Spine animation video watch page from World SPINE ARCHIVE on Spine Portfolio.`,
    300,
  );
  const uploadedAt = isoDate(entry?.uploadedAt) || '2026-05-12T00:00:00.000Z';
  const proofDocuments = proofDocumentsForEntry(origin, entry, pageUrl);
  const sourceProofUrl = sourceProofUrlForEntry(origin, entry);
  const blockchainAnchorUrl = blockchainAnchorUrlForEntry(origin, entry);
  const proofHash = sanitizeSha256(entry?.sourceProof?.proofHash || entry?.blockchainAnchor?.sourceProofHash);
  const anchorHash = sanitizeSha256(entry?.blockchainAnchor?.anchorHash);
  const videoRatio =
    positiveInteger(entry?.previewWidth) && positiveInteger(entry?.previewHeight)
      ? `${positiveInteger(entry.previewWidth)} / ${positiveInteger(entry.previewHeight)}`
      : '16 / 9';
  const videoStructuredData = mediaVideo
    ? {
        '@type': 'VideoObject',
        '@id': `${pageUrl}#video`,
        name: rawTitle,
        description,
        thumbnailUrl: [mediaImage],
        contentUrl: mediaVideo,
        embedUrl: pageUrl,
        url: pageUrl,
        mainEntityOfPage: pageUrl,
        uploadDate: uploadedAt,
        isFamilyFriendly: true,
        ...(durationToIso8601(entry?.previewDuration) ? { duration: durationToIso8601(entry.previewDuration) } : {}),
        ...(positiveInteger(entry?.previewWidth) ? { width: positiveInteger(entry.previewWidth) } : {}),
        ...(positiveInteger(entry?.previewHeight) ? { height: positiveInteger(entry.previewHeight) } : {}),
        ...(proofDocuments.length ? { subjectOf: proofDocuments.map((document) => ({ '@id': document['@id'] })) } : {}),
        interactionStatistic: [
          {
            '@type': 'InteractionCounter',
            interactionType: { '@type': 'LikeAction' },
            userInteractionCount: metric.likes,
          },
          {
            '@type': 'InteractionCounter',
            interactionType: { '@type': 'WatchAction' },
            userInteractionCount: metric.views,
          },
        ],
        creator: {
          '@type': 'Person',
          name: ownerName,
        },
        publisher: {
          '@type': 'Organization',
          name: 'Spine Portfolio',
          alternateName: 'Spine-Link',
          url: origin,
          logo: {
            '@type': 'ImageObject',
            url: `${origin}/favicon-64.png`,
            width: 64,
            height: 64,
          },
        },
        potentialAction: {
          '@type': 'WatchAction',
          target: pageUrl,
        },
      }
    : {
        '@type': 'CreativeWork',
        '@id': `${pageUrl}#work`,
        name: rawTitle,
        description,
        image: mediaImage,
        url: pageUrl,
        datePublished: uploadedAt,
        ...(proofDocuments.length ? { subjectOf: proofDocuments.map((document) => ({ '@id': document['@id'] })) } : {}),
      };
  const videoPageStructuredData = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'WebPage',
        '@id': `${pageUrl}#webpage`,
        name: `${rawTitle} - Spine animation video`,
        description,
        url: pageUrl,
        mainEntity: { '@id': videoStructuredData['@id'] },
        primaryImageOfPage: {
          '@type': 'ImageObject',
          url: mediaImage,
        },
        isPartOf: {
          '@type': 'CollectionPage',
          '@id': `${origin}/world-spine-archive#collection`,
          name: 'World SPINE ARCHIVE',
          url: `${origin}/world-spine-archive`,
        },
      },
      videoStructuredData,
      ...proofDocuments,
      {
        '@type': 'BreadcrumbList',
        '@id': `${pageUrl}#breadcrumbs`,
        itemListElement: [
          {
            '@type': 'ListItem',
            position: 1,
            name: 'Spine Portfolio',
            item: origin,
          },
          {
            '@type': 'ListItem',
            position: 2,
            name: 'World SPINE ARCHIVE',
            item: `${origin}/world-spine-archive`,
          },
          {
            '@type': 'ListItem',
            position: 3,
            name: `${rawTitle} video`,
            item: pageUrl,
          },
        ],
      },
    ],
  };
  const noVideoHtml = '<p class="muted">This Spine work does not have a crawlable WebM video preview yet.</p>';
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title} - Spine animation video</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <meta name="robots" content="${mediaVideo ? 'index,follow,max-image-preview:large,max-video-preview:-1,max-snippet:-1' : 'noindex,follow'}" />
    <meta name="googlebot" content="${mediaVideo ? 'index,follow,max-image-preview:large,max-video-preview:-1,max-snippet:-1' : 'noindex,follow'}" />
    <link rel="canonical" href="${escapeHtml(pageUrl)}" />
    <link rel="alternate" href="${escapeHtml(archivePageUrl)}" title="${title} archive detail page" />
    <link rel="alternate" href="${escapeHtml(playerPageUrl)}" title="${title} interactive Spine player" />
    <link rel="stylesheet" href="/page-transitions.css" />
    <meta property="og:type" content="${mediaVideo ? 'video.other' : 'article'}" />
    <meta property="og:title" content="${title} - Spine animation video" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:url" content="${escapeHtml(pageUrl)}" />
    <meta property="og:site_name" content="Spine Portfolio" />
    <meta property="og:image" content="${escapeHtml(mediaImage)}" />
    ${mediaVideo ? `<meta property="og:video" content="${escapeHtml(mediaVideo)}" />
    <meta property="og:video:secure_url" content="${escapeHtml(mediaVideo)}" />
    <meta property="og:video:type" content="video/webm" />` : ''}
    <meta name="twitter:card" content="player" />
    <meta name="twitter:title" content="${title} - Spine animation video" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${escapeHtml(mediaImage)}" />
    ${mediaVideo ? `<meta name="twitter:player" content="${escapeHtml(pageUrl)}" />` : ''}
    <script type="application/ld+json">${jsonScript(videoPageStructuredData)}</script>
    <script src="/page-transitions.js" defer></script>
    <style>
      ${baseStyles()}
      .watch { display: grid; gap: 16px; max-width: 1180px; margin: 0 auto; }
      .watch-player { display: grid; gap: 10px; }
      .video-frame { display: flex; align-items: center; justify-content: center; width: 100%; min-height: min(62vh, 760px); overflow: hidden; border: 1px solid rgba(255,185,214,.42); border-radius: 8px; background: #000; box-shadow: 0 22px 72px rgba(0,0,0,.44); }
      .video-frame video { display: block; width: auto; height: auto; max-width: 100%; max-height: min(72vh, 820px); aspect-ratio: ${escapeHtml(videoRatio)}; object-fit: contain; background: #000; }
      h1 { margin: 0; color: #fff; font-size: clamp(32px, 7vw, 82px); line-height: .9; }
      .watch-copy { display: grid; gap: 10px; }
      .watch-copy p { max-width: 860px; margin: 0; color: rgba(237,245,255,.74); font-size: 16px; line-height: 1.45; }
      .watch-actions, .metric-row, .proof-panel { display: flex; flex-wrap: wrap; gap: 8px; }
      .watch-actions a, .metric-pill, .proof-panel a { display: inline-flex; align-items: center; justify-content: center; min-height: 42px; padding: 0 13px; border: 1px solid rgba(140,199,255,.28); border-radius: 8px; color: #dff1ff; background: rgba(140,199,255,.08); font-size: 13px; font-weight: 900; text-decoration: none; }
      .watch-actions a.is-primary { border-color: rgba(179,255,64,.64); color: #eaffc2; background: rgba(179,255,64,.11); }
      .metric-pill { border-radius: 999px; color: rgba(237,245,255,.9); background: rgba(5,7,9,.58); }
      .metric-like-button { border-color: rgba(255,185,214,.32); color: #ffe4ef; cursor: pointer; user-select: none; }
      .metric-like-button.is-liked { border-color: rgba(255,118,171,.78); color: #ff76ab; background: rgba(255,118,171,.16); }
      .proof-panel { padding-top: 4px; }
      .proof-panel a { min-height: 36px; font-size: 12px; }
      .proof-panel code { margin-left: 8px; color: rgba(237,245,255,.66); font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace; font-size: 10px; }
      @media (max-width: 700px) {
        .video-frame { min-height: 54vh; }
        .video-frame video { max-height: 62vh; }
      }
    </style>
  </head>
  <body>
    <main class="page watch">
      <header class="top">
        <a class="archive-logo" href="/" aria-label="Spine-Link home">
          <span>s</span><span>p</span><span class="archive-logo-mark" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span><span>n</span><span>e</span><span class="archive-logo-link">link</span>
        </a>
        <div class="item-header-title">
          <a class="back" href="/world-spine-archive">World SPINE ARCHIVE</a>
          <span>Dedicated video watch page</span>
        </div>
        <div class="archive-header-right">
          <a class="back" href="/">Create preview</a>
        </div>
      </header>
      <section class="watch-player" aria-label="${title} video watch page">
        <div class="video-frame">
          ${mediaVideo ? `<video src="${escapeHtml(mediaVideo)}" poster="${escapeHtml(mediaImage)}" muted playsinline preload="metadata" autoplay controls></video>` : noVideoHtml}
        </div>
        <div class="watch-copy">
          <h1>${title}</h1>
          <p>${escapeHtml(description)}</p>
          <div class="metric-row" data-metric-id="${safeEntryId}" data-metric-label="stats" aria-label="${metric.likes} likes and ${metric.views} views">
            <span class="metric-pill metric-like-button" data-metric-id="${safeEntryId}" data-metric-like data-metric-current-likes="${metric.likes}" data-metric-current-views="${metric.views}" role="button" tabindex="0" aria-pressed="false" title="Like"><span data-metric-like-icon aria-hidden="true">♡</span><strong data-metric-likes>${metric.likes}</strong></span>
            <span class="metric-pill" data-metric-id="${safeEntryId}" data-metric-current-likes="${metric.likes}" data-metric-current-views="${metric.views}"><span aria-hidden="true">◉</span><strong data-metric-views>${metric.views}</strong><span> views</span></span>
          </div>
          ${sourceProofUrl || blockchainAnchorUrl ? `<div class="proof-panel">
            ${sourceProofUrl ? `<a href="${escapeHtml(sourceProofUrl)}" target="_blank" rel="noreferrer">source-proof.json${proofHash ? `<code>${escapeHtml(shortHash(proofHash))}</code>` : ''}</a>` : ''}
            ${blockchainAnchorUrl ? `<a href="${escapeHtml(blockchainAnchorUrl)}" target="_blank" rel="noreferrer">blockchain-anchor.json${anchorHash ? `<code>${escapeHtml(shortHash(anchorHash))}</code>` : ''}</a>` : ''}
          </div>` : ''}
          <nav class="watch-actions" aria-label="${title} related pages">
            <a class="is-primary" href="${previewUrl(entry)}">Open interactive Spine player</a>
            <a href="${archiveItemUrl(entry)}">Archive detail</a>
          </nav>
        </div>
      </section>
    </main>
    <script>window.SpineLinkMetricsConfig = { viewId: ${JSON.stringify(entryId)} };</script>
    <script src="/spine-metrics.js" defer></script>
  </body>
</html>`;
}

export default async function handler(request, response) {
  if (!['GET', 'HEAD'].includes(request.method)) {
    response.setHeader('Allow', 'GET, HEAD');
    return response.status(405).send('Method not allowed');
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) return response.status(500).send('GITHUB_TOKEN is not configured');

  const settings = {
    owner: process.env.GITHUB_OWNER || defaultOwner,
    repo: process.env.GITHUB_REPO || defaultRepo,
    branch: process.env.GITHUB_BRANCH || defaultBranch,
    basePath: cleanRepoPath(process.env.GITHUB_BASE_PATH || defaultBasePath),
    token,
  };
  const origin = `${request.headers['x-forwarded-proto'] || 'https'}://${request.headers['x-forwarded-host'] || request.headers.host}`;

  try {
    const indexText = await githubText(settings, `${settings.basePath}/index.json`);
    const exclusionsText = await githubText(settings, `${settings.basePath}/archive-exclusions.json`);
    const metricsText = await githubText(settings, `${settings.basePath}/metrics.json`);
    const exclusions = exclusionsText ? JSON.parse(exclusionsText) : { rules: [] };
    const metrics = parseMetricsJson(metricsText);
    const allEntries = indexText ? JSON.parse(indexText) : [];
    const entries = Array.isArray(allEntries)
      ? allEntries.filter((entry) => (
          entry?.hiddenFromPublicLibrary !== true &&
          (entry?.webmPreview || entry?.thumbnail || entry?.thumbnailPoster) &&
          !entryExcludedFromArchive(entry, exclusions)
        ))
      : [];
    entries.sort(compareArchiveEntries);

    if (request.query?.feed === 'home') {
      response.setHeader('Content-Type', 'application/json; charset=utf-8');
      setCacheHeaders(response, cacheProfiles.listBrowser, cacheProfiles.listCdn);
      if (request.method === 'HEAD') {
        return response.status(200).send('');
      }
      return response.status(200).json({
        ok: true,
        generatedAt: new Date().toISOString(),
        entries: homepageFeedEntries(origin, entries, metrics),
      });
    }

    const layoutEntries = await enrichArchiveLayout(settings, origin, entries);

    const archiveId = String(request.query?.id || '').trim();
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.setHeader('X-Robots-Tag', 'index, follow, max-image-preview:large, max-video-preview:-1, max-snippet:-1');
    if (archiveId) {
      const entry = layoutEntries.find((item) => String(item?.id || '') === archiveId);
      setCacheHeaders(response, cacheProfiles.dynamicHtmlBrowser, cacheProfiles.dynamicHtmlCdn);
      if (request.method === 'HEAD') {
        return response.status(entry ? 200 : 404).send('');
      }
      const isVideoWatchPage = request.query?.view === 'video' || request.query?.video === '1';
      if (isVideoWatchPage && (!entry || !entryVideoAsset(entry?.webmPreview || '', entry, 'webm'))) {
        response.setHeader('X-Robots-Tag', 'noindex, follow');
      }
      return response.status(entry ? 200 : 404).send(
        entry
          ? isVideoWatchPage
            ? archiveVideoHtml({ origin, entry, metrics })
            : archiveItemHtml({ origin, entry, metrics })
          : 'Archive item not found',
      );
    }

    setCacheHeaders(response, cacheProfiles.dynamicHtmlBrowser, cacheProfiles.dynamicHtmlCdn);
    if (request.method === 'HEAD') {
      return response.status(200).send('');
    }
    return response.status(200).send(archiveHtml({ origin, entries: layoutEntries, exclusions, metrics }));
  } catch (error) {
    return response.status(500).send(error instanceof Error ? error.message : 'Archive failed');
  }
}
