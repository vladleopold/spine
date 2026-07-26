import { metricCountsForId, parseMetricsJson } from '../lib/spine-metrics.js';
import { cacheProfiles, setCacheHeaders } from '../lib/cache-headers.js';
import { appendAssetVersion, assetVersionForEntry } from '../lib/asset-version.js';
import { cachedGithubText } from '../lib/github-content-cache.js';

const defaultOwner = 'vladleopold';
const defaultRepo = 'spine';
const defaultBranch = 'main';
const defaultBasePath = 'library';
const legacyPublicOwnerAliases = {
  u_rdrnig: 'u_yois91',
};

function cleanRepoPath(value = '') {
  return String(value).trim().replace(/^\/+|\/+$/g, '').replace(/\/+/g, '/');
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

function assetUrlForRepoPath(origin, path, version = '') {
  return appendAssetVersion(`${origin}/assets/${encodeRepoPath(path)}`, version);
}

function archiveItemPath(entry) {
  const id = String(entry?.id || '').trim();
  return id ? `/world-spine-archive/${encodeURIComponent(id)}` : '';
}

function playerPathForEntry(entry) {
  const id = String(entry?.id || '').trim();
  if (!id) return '';
  const animation = String(entry?.defaultAnimation || '').trim();
  const basePath = `/p/${encodeURIComponent(id)}`;
  return animation ? `${basePath}?animation=${encodeURIComponent(animation)}` : basePath;
}

function absoluteUrlForPath(origin, path) {
  return path ? `${origin}${path}` : origin;
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

function cleanPublicText(value = '', maxLength = 280) {
  return String(value).replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function safeImage(value = '') {
  const url = String(value).trim();
  return /^https:\/\/[^\s"'<>]+$/i.test(url) ? url : '';
}

function safeVideo(value = '') {
  const url = String(value).trim();
  return /^https:\/\/[^\s"'<>]+\.webm(?:[?#][^\s"'<>]*)?$/i.test(url) ? url : '';
}

function entryImageAsset(value = '', entry = {}, fallback = '') {
  return appendAssetVersion(safeImage(value), assetVersionForEntry(entry, fallback));
}

function entryVideoAsset(value = '', entry = {}, fallback = '') {
  return appendAssetVersion(safeVideo(value), assetVersionForEntry(entry, fallback));
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

function derivedMediaFromFiles(origin, entry, extensions) {
  const previewPath = cleanRepoPath(entry?.previewPath || '');
  const files = Array.isArray(entry?.files) ? entry.files : [];
  const file = files.find((item) => extensions.some((extension) => String(item || '').toLowerCase().endsWith(extension)));
  return previewPath && file ? assetUrlForRepoPath(origin, joinRepoPath(previewPath, String(file)), assetVersionForEntry(entry, file)) : '';
}

function generatedThumbnailUrl(origin, entry) {
  const id = String(entry?.id || '').trim();
  const poster = String(entry?.thumbnailPoster || '');
  return id && /^data:image\/webp;base64,/i.test(poster)
    ? assetUrlForRepoPath(origin, `library/${id}/generated-preview.webp`, assetVersionForEntry(entry, 'generated-preview'))
    : '';
}

function generatedPreviewWebmUrl(origin, entry) {
  const id = String(entry?.id || '').trim();
  return id ? `${origin}/v_holder.webm` : '';
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

function compareLibraryEntries(a, b) {
  const aOrder = Number(a?.libraryOrder);
  const bOrder = Number(b?.libraryOrder);
  const hasAOrder = Number.isFinite(aOrder);
  const hasBOrder = Number.isFinite(bOrder);
  if (hasAOrder && hasBOrder && aOrder !== bOrder) return aOrder - bOrder;
  if (hasAOrder !== hasBOrder) return hasAOrder ? -1 : 1;
  return String(b?.uploadedAt || '').localeCompare(String(a?.uploadedAt || ''));
}

function libraryCardSizeClassForRatio(ratio) {
  if (!Number.isFinite(ratio) || ratio <= 0) return 'library-card--square';
  if (ratio >= 3.2) return 'library-card--full';
  if (ratio >= 1.85) return 'library-card--wide';
  if (ratio >= 1.35) return 'library-card--horizontal';
  if (ratio >= 1.12) return 'library-card--medium-wide';
  if (ratio <= 0.62) return 'library-card--vertical';
  if (ratio <= 0.72) return 'library-card--medium-narrow';
  return 'library-card--square';
}

function libraryCardSizeClassForManualSize(size = '') {
  if (!size || size === 'auto') return '';
  return `library-card--${size}`;
}

function fallbackLibraryCardSizeClass(index = 0) {
  const fallbackSizes = [
    'library-card--horizontal',
    'library-card--square',
    'library-card--medium-wide',
    'library-card--vertical',
    'library-card--large-rect',
    'library-card--wide',
    'library-card--medium-narrow',
    'library-card--square',
  ];
  return fallbackSizes[Math.abs(index) % fallbackSizes.length];
}

function libraryCardSizeClass(entry, index = 0) {
  const manualClass = libraryCardSizeClassForManualSize(entry?.cardSize);
  const mediaRatio = Number(entry?.mediaAspectRatio || 0);
  const width = Number(entry?.previewWidth || entry?.thumbnailWidth || entry?.mediaWidth || 0);
  const height = Number(entry?.previewHeight || entry?.thumbnailHeight || entry?.mediaHeight || 0);
  const ratio = mediaRatio > 0 ? mediaRatio : width > 0 && height > 0 ? width / height : 0;
  if (manualClass === 'library-card--medium-narrow' && ratio >= 0.75 && ratio <= 1.15) return 'library-card--square';
  if (manualClass) return manualClass;
  if (!ratio) return fallbackLibraryCardSizeClass(index);
  return libraryCardSizeClassForRatio(ratio);
}

function indexablePortfolioState(entries) {
  const visibleEntries = (Array.isArray(entries) ? entries : []).filter((entry) => !entry?.hiddenFromPublicLibrary);
  return {
    visibleEntries,
    isPortfolioMode: (Array.isArray(entries) ? entries : []).some((entry) => entry?.portfolioMode === true),
  };
}

function createLibraryHtml({ origin, publicOwnerId, entries, metrics }) {
  const { visibleEntries, isPortfolioMode } = indexablePortfolioState(entries);
  const firstEntry = visibleEntries[0] || entries[0] || {};
  const showOwnerName = firstEntry.showOwnerLibrary !== false;
  const ownerName = escapeHtml(showOwnerName ? firstEntry.ownerName || 'Spine-Link creator' : 'Spine-Link library');
  const rawOwnerName = showOwnerName ? firstEntry.ownerName || 'Spine-Link creator' : 'Spine-Link library';
  const ownerPicture = showOwnerName ? safeImage(firstEntry.ownerPicture || '') : '';
  const ownerInitial = ownerName.replace(/&[^;]+;/g, '').slice(0, 1).toUpperCase() || 'S';
  const publicPageLabel = isPortfolioMode ? 'Portfolio' : 'Library';
  const publicPageLabelLower = publicPageLabel.toLowerCase();
  const publicPageClass = isPortfolioMode ? 'is-portfolio-page' : 'is-library-page';
  const indexablePortfolio = isPortfolioMode && visibleEntries.length > 0;
  const title = `${rawOwnerName} - Spine animation ${publicPageLabelLower}`;
  const description = indexablePortfolio
    ? `${rawOwnerName} portfolio on Spine-Link with ${visibleEntries.length} uploaded Spine animation work${visibleEntries.length === 1 ? '' : 's'}, preview videos, files, and public animation cards.`
    : `${rawOwnerName} Spine-Link library page.`;
  const cards = visibleEntries
    .map((entry, index) => {
      const itemTitle = escapeHtml(entry.title || entry.id || 'Spine preview');
      const previewPath = isPortfolioMode ? archiveItemPath(entry) : playerPathForEntry(entry);
      const previewUrl = previewPath || playerPathForEntry(entry) || '/';
      const rawThumbnail = entryImageAsset(entry.thumbnail || '', entry, 'thumbnail');
      const derivedTexture = derivedMediaFromFiles(origin, entry, ['.png', '.jpg', '.jpeg', '.webp']);
      const thumbnailPoster = entryImageAsset(entry.thumbnailPoster || '', entry, 'poster') || generatedThumbnailUrl(origin, entry) || derivedTexture;
      const webmPreview = entryVideoAsset(entry.webmPreview || '', entry, 'webm') || derivedMediaFromFiles(origin, entry, ['.webm']) || generatedPreviewWebmUrl(origin, entry);
      const isGifPreview = entry.thumbnailType === 'gif' || /^data:image\/gif;base64,/i.test(rawThumbnail);
      const thumbnail = isGifPreview ? '' : rawThumbnail;
      const date = entry.uploadedAt ? new Date(entry.uploadedAt) : null;
      const dateText = date && !Number.isNaN(date.getTime())
        ? `${date.toLocaleDateString()} ${date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}`
        : 'Saved';
      const animations = Array.isArray(entry.animations) ? entry.animations.length : 0;
      const files = Array.isArray(entry.files) ? entry.files.length : 0;
      const entryId = escapeHtml(String(entry.id || ''));
      const likeId = String(entry.id || itemTitle);
      const metric = metricCountsForId(metrics, likeId);
      const likeCount = metric.likes;
      const viewCount = metric.views;
      const thumbnailStyle = thumbnail || thumbnailPoster ? ` style="--library-thumbnail: url('${escapeHtml(thumbnailPoster || thumbnail)}')"` : '';
      const previewMedia = `<video class="library-card-webm"${webmPreview ? ` src="${escapeHtml(webmPreview)}" data-video-src="${escapeHtml(webmPreview)}"` : ''}${thumbnailPoster || thumbnail ? ` poster="${escapeHtml(thumbnailPoster || thumbnail)}"` : ''} muted playsinline preload="metadata" autoplay aria-label="${itemTitle} video preview"></video>`;
      const likeButton = isPortfolioMode ? `<button class="portfolio-like-button" type="button" data-metric-id="${escapeHtml(likeId)}" data-metric-like data-metric-current-likes="${likeCount}" data-metric-current-views="${viewCount}" aria-pressed="false" title="Like"><span data-metric-like-icon aria-hidden="true">♡</span><strong data-metric-likes>${likeCount}</strong></button>` : '';
      const cardSizeMode = entry.cardSize && entry.cardSize !== 'auto' ? 'manual' : 'auto';
      return `<article class="library-card ${libraryCardSizeClass(entry, index)}" data-entry-id="${entryId}" data-card-size-mode="${cardSizeMode}"${thumbnailStyle}>
        ${likeButton}
        <a class="library-card-link" href="${previewUrl}" aria-label="Open ${itemTitle}${isPortfolioMode ? ' in World SPINE ARCHIVE' : ''}">
          <div class="library-card-visual">
            ${previewMedia}
            <span class="stack-icon" aria-hidden="true"></span>
            <span>${animations}</span>
          </div>
          <div class="library-card-body">
            <div class="library-card-title-row">
              <strong>${itemTitle}</strong>
              <span class="library-card-date">${escapeHtml(dateText)}</span>
            </div>
            ${entry.note ? `<p>${escapeHtml(entry.note)}</p>` : ''}
            <div class="library-card-meta" data-metric-id="${entryId}" data-metric-label="stats" aria-label="${likeCount} likes and ${viewCount} views"><span><span aria-hidden="true">◉</span> <strong data-metric-views>${viewCount}</strong> views</span><span>${files} files</span></div>
          </div>
        </a>
      </article>`;
    })
    .join('');
  const absoluteProfileUrl = `${origin}/u/${encodeURIComponent(publicOwnerId)}`;
  const firstImage = visibleEntries
    .map((entry) => entryImageAsset(entry.thumbnailPoster || '', entry, 'poster') || entryImageAsset(entry.thumbnail || '', entry, 'thumbnail') || generatedThumbnailUrl(origin, entry) || derivedMediaFromFiles(origin, entry, ['.webp', '.png', '.jpg', '.jpeg']))
    .find(Boolean) || `${origin}/spine-link-video-thumbnail.png`;
  const itemListElements = visibleEntries.map((entry, index) => {
    const name = cleanPublicText(entry.title || entry.id || 'Spine animation work', 120);
    const canonicalPath = isPortfolioMode ? archiveItemPath(entry) : playerPathForEntry(entry);
    const url = absoluteUrlForPath(origin, canonicalPath || playerPathForEntry(entry));
    const embedUrl = absoluteUrlForPath(origin, playerPathForEntry(entry) || canonicalPath);
    const image = entryImageAsset(entry.thumbnailPoster || '', entry, 'poster') || entryImageAsset(entry.thumbnail || '', entry, 'thumbnail') || generatedThumbnailUrl(origin, entry) || derivedMediaFromFiles(origin, entry, ['.webp', '.png', '.jpg', '.jpeg']) || undefined;
    const video = entryVideoAsset(entry.webmPreview || '', entry, 'webm') || derivedMediaFromFiles(origin, entry, ['.webm']) || undefined;
    const work = {
      '@type': video ? 'VideoObject' : 'CreativeWork',
      ...(video ? { '@id': `${url}#video` } : {}),
      name,
      url,
      description: cleanPublicText(entry.note || `${name} uploaded to ${rawOwnerName}'s Spine animation portfolio on Spine-Link.`, 260),
      ...(image ? { image, thumbnailUrl: video ? [image] : image } : {}),
      ...(video
        ? {
            contentUrl: video,
            embedUrl,
            mainEntityOfPage: url,
            isFamilyFriendly: true,
            ...(durationToIso8601(entry.previewDuration) ? { duration: durationToIso8601(entry.previewDuration) } : {}),
            ...(positiveInteger(entry.previewWidth) ? { width: positiveInteger(entry.previewWidth) } : {}),
            ...(positiveInteger(entry.previewHeight) ? { height: positiveInteger(entry.previewHeight) } : {}),
            potentialAction: {
              '@type': 'WatchAction',
              target: embedUrl,
            },
          }
        : {}),
      ...(entry.uploadedAt ? { uploadDate: isoDate(entry.uploadedAt), datePublished: isoDate(entry.uploadedAt) } : {}),
      creator: {
        '@type': 'Person',
        name: rawOwnerName,
        url: absoluteProfileUrl,
      },
    };
    return {
      '@type': 'ListItem',
      position: index + 1,
      url,
      name,
      item: work,
    };
  });
  const firstVideoEntry = visibleEntries.find((entry) => entryVideoAsset(entry.webmPreview || '', entry, 'webm') || derivedMediaFromFiles(origin, entry, ['.webm']));
  const firstVideoUrl = firstVideoEntry ? entryVideoAsset(firstVideoEntry.webmPreview || '', firstVideoEntry, 'webm') || derivedMediaFromFiles(origin, firstVideoEntry, ['.webm']) : '';
  const structuredData = {
    '@context': 'https://schema.org',
    '@graph': [
      {
        '@type': 'BreadcrumbList',
        '@id': `${absoluteProfileUrl}#breadcrumb`,
        itemListElement: [
          { '@type': 'ListItem', position: 1, name: 'Spine-Link', item: origin },
          { '@type': 'ListItem', position: 2, name: rawOwnerName, item: absoluteProfileUrl },
        ],
      },
      {
        '@type': 'ProfilePage',
        '@id': `${absoluteProfileUrl}#profile`,
        name: title,
        url: absoluteProfileUrl,
        description,
        isPartOf: {
          '@type': 'WebSite',
          name: 'Spine Portfolio',
          alternateName: 'Spine-Link',
          url: origin,
        },
        about: {
          '@type': 'Person',
          '@id': `${absoluteProfileUrl}#person`,
          name: rawOwnerName,
          url: absoluteProfileUrl,
          ...(ownerPicture ? { image: ownerPicture } : {}),
          description: `${rawOwnerName} publishes Spine animation portfolio work on Spine-Link.`,
        },
        mainEntity: {
          '@id': `${absoluteProfileUrl}#person`,
        },
      },
      {
        '@type': 'ItemList',
        '@id': `${absoluteProfileUrl}#works`,
        name: `${rawOwnerName} Spine animation portfolio works`,
        url: absoluteProfileUrl,
        numberOfItems: visibleEntries.length,
        itemListElement: itemListElements,
      },
    ],
  };

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)}</title>
    <meta name="description" content="${escapeHtml(description)}" />
    <meta name="robots" content="${indexablePortfolio ? 'index,follow,max-image-preview:large,max-video-preview:-1,max-snippet:-1' : 'noindex,follow'}" />
    <meta name="application-name" content="Spine Portfolio" />
    <meta name="apple-mobile-web-app-title" content="Spine Portfolio" />
    <meta name="theme-color" content="#000000" />
    <meta name="referrer" content="strict-origin-when-cross-origin" />
    <link rel="preconnect" href="https://cdn.jsdelivr.net" crossorigin />
    <link rel="preconnect" href="https://accounts.google.com" crossorigin />
    <link rel="dns-prefetch" href="https://api.github.com" />
    <meta property="og:type" content="profile" />
    <meta property="og:url" content="${escapeHtml(absoluteProfileUrl)}" />
    <meta property="og:title" content="${escapeHtml(title)}" />
    <meta property="og:description" content="${escapeHtml(description)}" />
    <meta property="og:site_name" content="Spine Portfolio" />
    <meta property="og:image" content="${escapeHtml(firstImage)}" />
    ${firstVideoUrl ? `<meta property="og:video" content="${escapeHtml(firstVideoUrl)}" />
    <meta property="og:video:secure_url" content="${escapeHtml(firstVideoUrl)}" />
    <meta property="og:video:type" content="video/webm" />` : ''}
    <meta name="twitter:card" content="summary_large_image" />
    <meta name="twitter:title" content="${escapeHtml(title)}" />
    <meta name="twitter:description" content="${escapeHtml(description)}" />
    <meta name="twitter:image" content="${escapeHtml(firstImage)}" />
    <link rel="canonical" href="${escapeHtml(absoluteProfileUrl)}" />
    <link rel="stylesheet" href="/page-transitions.css" />
    <script type="application/ld+json">${jsonScript(structuredData)}</script>
    <script src="/page-transitions.js" defer></script>
    <style>
      * { box-sizing: border-box; }
      * { scrollbar-width: thin; scrollbar-color: rgba(74,78,84,.72) transparent; }
      *::-webkit-scrollbar { width: 8px; height: 8px; }
      *::-webkit-scrollbar-track { background: transparent; }
      *::-webkit-scrollbar-thumb { border: 2px solid transparent; border-radius: 999px; background: rgba(74,78,84,.72); background-clip: content-box; }
      *::-webkit-scrollbar-thumb:hover { background: rgba(100,106,115,.78); background-clip: content-box; }
      body { min-height: 100vh; margin: 0; color: #edf5ff; background: #070809; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      .page { position: relative; z-index: 1; width: min(1280px, calc(100% - 24px)); margin: 0 auto; padding: 22px 0 48px; }
      .creator-card { display: grid; grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); align-items: center; gap: 18px; width: 100%; margin-bottom: 14px; padding: 0; border: 0; border-radius: 0; background: transparent; box-shadow: none; backdrop-filter: none; }
      .creator-logo { display: inline-flex; align-items: center; justify-self: start; min-width: 0; color: #fff; text-decoration: none; }
      .creator-logo-mark { display: inline-flex; align-items: center; gap: 5px; max-width: 100%; color: #fff; font-family: "Trebuchet MS", Inter, ui-sans-serif, system-ui, sans-serif; font-size: clamp(26px, 4.4vw, 44px); font-weight: 500; line-height: .78; letter-spacing: .18em; text-shadow: 0 0 1px rgba(255,255,255,.86), 0 6px 18px rgba(0,0,0,.42); }
      .creator-logo-spine { display: inline-grid; gap: 3px; width: 12px; margin: 0 -3px 0 -5px; transform: translateY(0); }
      .creator-logo-spine i { display: block; width: 12px; height: 5px; border-radius: 999px; background: #ff5a1f; box-shadow: 0 0 8px rgba(255,90,31,.22); }
      .creator-logo-spine i:nth-child(2) { width: 11px; transform: translateX(2px); }
      .creator-logo-spine i:nth-child(3) { width: 10px; transform: translateX(3px); }
      .creator-logo-spine i:nth-child(4) { width: 9px; transform: translateX(4px); }
      .creator-logo-spine i:nth-child(5) { width: 8px; transform: translateX(5px); }
      .creator-logo-plus { margin-left: 4px; color: #ff6a28; font-size: .62em; font-weight: 800; letter-spacing: .18em; line-height: 1; text-transform: uppercase; transform: translate(-10px, .18em); }
      .creator-row { display: flex; align-items: center; justify-self: end; min-width: 0; max-width: 100%; }
      .creator-avatar { flex: 0 0 auto; width: 72px; height: 72px; overflow: hidden; border: 0; border-radius: 999px; background: #181b20; box-shadow: 0 0 0 1px rgba(140,199,255,.08); }
      .creator-avatar img { display: block; width: 100%; height: 100%; object-fit: cover; }
      .creator-avatar-fallback { display: grid; place-items: center; width: 100%; height: 100%; color: #111; background: #b3ff40; font-size: 34px; font-weight: 950; }
      .creator-name-line { display: contents; }
      .creator-name { display: none; }
      .creator-count { justify-self: center; color: rgba(237,245,255,.66); font-size: clamp(19px, 3.8vw, 32px); font-weight: 950; letter-spacing: .13em; white-space: nowrap; text-transform: uppercase; }
      .portfolio-search-copy { margin: 0 0 18px; color: rgba(237,245,255,.76); }
      .portfolio-search-copy h1 { margin: 0 0 6px; color: #fff; font-size: clamp(24px, 4vw, 48px); font-weight: 950; line-height: 1; }
      .portfolio-search-copy p { max-width: 760px; margin: 0; font-size: 15px; line-height: 1.55; }
      .library-grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(116px, 1fr)); grid-auto-flow: dense; grid-auto-rows: 96px; gap: 18px; }
      .library-card { position: relative; display: flex; flex-direction: column; width: 100%; height: 100%; margin: 0; overflow: hidden; border: 2px solid rgba(255,185,214,.72); border-radius: 8px; color: inherit; background: radial-gradient(circle at 22% 22%, rgba(255,106,40,.28), transparent 36%), radial-gradient(circle at 78% 16%, rgba(140,199,255,.32), transparent 32%), linear-gradient(135deg, rgba(32,35,38,.98), rgba(20,22,25,.98)); box-shadow: 0 0 0 1px rgba(255,185,214,.2), 0 20px 56px rgba(0,0,0,.34); transition: transform 150ms ease, border-color 150ms ease; }
      .library-card--small-square { grid-column: span 2; grid-row: span 2; }
      .library-card--square { grid-column: span 3; grid-row: span 3; }
      .library-card--horizontal { grid-column: span 4; grid-row: span 2; }
      .library-card--wide { grid-column: span 6; grid-row: span 2; }
      .library-card--vertical { grid-column: span 2; grid-row: span 7; }
      .library-card--medium-narrow { grid-column: span 2; grid-row: span 3; }
      .library-card--medium-wide { grid-column: span 4; grid-row: span 3; }
      .library-card--large-rect { grid-column: span 4; grid-row: span 4; }
      .library-card--full { grid-column: 1 / -1; grid-row: span 3; }
      .library-card:hover { transform: translateY(-3px); border-color: #ffe4ef; }
      .is-library-page .library-card { border-color: rgba(140,199,255,.58); box-shadow: 0 0 0 1px rgba(140,199,255,.14), 0 20px 56px rgba(0,0,0,.34); }
      .is-library-page .library-card:hover { border-color: rgba(179,255,64,.9); }
      .library-card::before { content: ""; position: absolute; inset: 0; z-index: 0; background-image: var(--library-thumbnail); background-position: center; background-repeat: no-repeat; background-size: contain; opacity: .92; transform: none; transform-origin: center; }
      .library-card::after { content: ""; position: absolute; inset: 0; z-index: 0; background: linear-gradient(rgba(8,10,12,.34), rgba(8,10,12,.52)), radial-gradient(circle at 22% 22%, rgba(255,106,40,.14), transparent 36%), radial-gradient(circle at 78% 16%, rgba(140,199,255,.18), transparent 32%); pointer-events: none; }
      .library-card-link { position: relative; z-index: 1; display: flex; flex: 1 1 auto; flex-direction: column; min-height: 0; color: inherit; text-decoration: none; }
      .library-card-visual { position: relative; display: flex; flex: 1 1 auto; align-items: flex-end; justify-content: space-between; min-height: 0; padding: 24px; color: #fff; background: linear-gradient(rgba(9,11,13,.05), rgba(9,11,13,.18)); overflow: hidden; }
      .library-card-webm { position: absolute; inset: 0; z-index: 0; width: 100%; height: 100%; object-fit: cover; opacity: .96; transform: none; transform-origin: center; pointer-events: none; }
      .portfolio-like-button { position: absolute; top: 14px; right: 14px; z-index: 3; display: inline-flex; align-items: center; gap: 7px; min-height: 34px; padding: 0 10px; border: 1px solid rgba(255,185,214,.42); border-radius: 999px; color: #ffe4ef; background: rgba(8,9,11,.68); box-shadow: 0 12px 30px rgba(0,0,0,.32); backdrop-filter: blur(10px); cursor: pointer; }
      .portfolio-like-button span { color: currentColor; font-size: 20px; line-height: 1; transform: translateY(-1px); }
      .portfolio-like-button strong { color: currentColor; font-size: 12px; font-weight: 950; line-height: 1; }
      .portfolio-like-button.is-liked { border-color: rgba(255,118,171,.78); color: #ff76ab; background: rgba(255,118,171,.14); }
      .library-card-visual > span { position: relative; z-index: 1; }
      .library-card-visual > span:last-child { font-size: 64px; font-weight: 900; line-height: .9; text-shadow: 0 2px 0 #000, 0 14px 34px rgba(0,0,0,.48); }
      .stack-icon { width: 28px; height: 28px; background: linear-gradient(#fff, #fff) 50% 4px / 24px 4px no-repeat, linear-gradient(#fff, #fff) 50% 12px / 24px 4px no-repeat, linear-gradient(#fff, #fff) 50% 20px / 24px 4px no-repeat; filter: drop-shadow(0 2px 0 #000); transform: skewY(-24deg); }
      .library-card-body { display: grid; gap: 8px; padding: 14px; background: rgba(17,17,20,.72); backdrop-filter: blur(10px); }
      .library-card-title-row { display: grid; grid-template-columns: minmax(0, 1fr) auto; align-items: start; gap: 12px; }
      .library-card-body strong { overflow: hidden; font-size: 17px; line-height: 1.2; text-overflow: ellipsis; white-space: nowrap; }
      .library-card-date { display: inline-flex; align-items: center; justify-content: flex-end; color: rgba(237,245,255,.58); font-size: 12px; white-space: nowrap; }
      .library-card-body p { display: -webkit-box; margin: 0; overflow: hidden; color: rgba(255,228,239,.78); font-size: 13px; line-height: 1.4; -webkit-box-orient: vertical; -webkit-line-clamp: 3; }
      .library-card-meta { display: flex; justify-content: flex-end; gap: 10px; color: rgba(237,245,255,.66); font-size: 12px; font-weight: 700; }
      .library-card-meta strong { color: inherit; font-size: inherit; }
      .empty { padding: 34px; border: 1px dashed rgba(255,255,255,.16); border-radius: 8px; color: rgba(237,245,255,.68); text-align: center; }
      @media (max-width: 1024px) { .library-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); grid-auto-rows: 98px; } .library-card, .library-card--small-square, .library-card--square, .library-card--horizontal, .library-card--wide, .library-card--vertical, .library-card--medium-narrow, .library-card--medium-wide, .library-card--large-rect, .library-card--full { grid-column: 1 / -1; grid-row: span 3; } }
      @media (max-width: 640px) { * { scrollbar-width: none; } *::-webkit-scrollbar { width: 0; height: 0; display: none; } .page { width: min(100% - 24px, 1280px); padding-top: 20px; } .creator-card { grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr); gap: 10px; margin-bottom: 8px; } .creator-logo-mark { font-size: clamp(23px, 7.3vw, 30px); letter-spacing: .13em; } .creator-count { font-size: clamp(18px, 4.7vw, 24px); letter-spacing: .13em; } .creator-row { justify-self: end; } .creator-avatar { width: clamp(54px, 13vw, 72px); height: clamp(54px, 13vw, 72px); } .creator-avatar-fallback { font-size: clamp(26px, 7vw, 34px); } .portfolio-search-copy { margin-bottom: 14px; } .library-grid { grid-template-columns: repeat(2, minmax(0, 1fr)); grid-auto-rows: 98px; } .library-card, .library-card--small-square, .library-card--square, .library-card--horizontal, .library-card--wide, .library-card--vertical, .library-card--medium-narrow, .library-card--medium-wide, .library-card--large-rect, .library-card--full { grid-column: 1 / -1; grid-row: span 3; } }
    </style>
  </head>
  <body class="${publicPageClass}">
    <main class="page">
      <section class="creator-card" aria-label="${publicPageLabel}">
        <a class="creator-logo" href="/" aria-label="Spine-Link home"><span class="creator-logo-mark" aria-hidden="true"><span>s</span><span>p</span><span class="creator-logo-spine"><i></i><i></i><i></i><i></i><i></i></span><span>n</span><span>e</span><span class="creator-logo-plus">link</span></span></a>
        <span class="creator-count">${visibleEntries.length} SPINE WORKS</span>
        <div class="creator-row">
          <div class="creator-avatar" aria-hidden="true">
            ${ownerPicture ? `<img src="${ownerPicture}" alt="" />` : `<div class="creator-avatar-fallback">${ownerInitial}</div>`}
          </div>
        </div>
      </section>
      <section class="portfolio-search-copy" aria-label="Portfolio description">
        <h1>${escapeHtml(rawOwnerName)} Spine animation portfolio</h1>
        <p>${escapeHtml(description)}</p>
      </section>
      ${visibleEntries.length ? `<section class="library-grid" aria-label="${escapeHtml(rawOwnerName)} uploaded Spine animation works">${cards}</section>` : `<div class="empty">This public ${publicPageLabelLower} is empty or hidden.</div>`}
    </main>
    <script>
      // Keep the portfolio page static by default; motion starts only on card hover.
      function cardClassForAspectRatio(ratio) {
        if (!Number.isFinite(ratio) || ratio <= 0) return "library-card--square";
        if (ratio >= 3.2) return "library-card--full";
        if (ratio >= 1.85) return "library-card--wide";
        if (ratio >= 1.35) return "library-card--horizontal";
        if (ratio >= 1.12) return "library-card--medium-wide";
        if (ratio <= 0.62) return "library-card--vertical";
        if (ratio <= 0.72) return "library-card--medium-narrow";
        return "library-card--square";
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
      function applyVideoAspectCardClass(video) {
        const card = video.closest(".library-card");
        if (!card || !video.videoWidth || !video.videoHeight) return;
        if (card.dataset.cardSizeMode === "manual") return;
        card.classList.remove(
          "library-card--small-square",
          "library-card--square",
          "library-card--horizontal",
          "library-card--wide",
          "library-card--vertical",
          "library-card--medium-narrow",
          "library-card--medium-wide",
          "library-card--large-rect",
          "library-card--full"
        );
        card.classList.add(cardClassForAspectRatio(selectedVideoAspectRatio(video)));
      }
      function warmVideoMetadata(video) {
        if (!video || video.readyState >= 1) return;
        video.preload = "metadata";
        try { video.load(); } catch {}
      }
      document.querySelectorAll(".library-card-webm").forEach((video) => {
        video.addEventListener("loadedmetadata", () => applyVideoAspectCardClass(video));
      });
      function stopVideo(video) {
        video.pause();
        video.onended = null;
        try { video.currentTime = 0; } catch {}
      }
      function playVideo(video) {
        const source = video.dataset.videoSrc || video.getAttribute("src") || "";
        if (!source) return false;
        if (!video.getAttribute("src")) video.setAttribute("src", source);
        video.muted = true;
        video.loop = false;
        video.playsInline = true;
        try { video.currentTime = 0; } catch {}
        video.play().catch(() => {});
        return true;
      }
      function installChaoticCardPlayback() {
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
              playVideo(video);
            }, 1000);
            hoverTimers.set(video, timer);
          };
          playVideo(video);
        }
        function stopHoverLoop(video) {
          manualVideos.delete(video);
          clearHoverTimer(video);
          stopVideo(video);
        }
        function scheduleChaos() {
          window.clearTimeout(chaosTimer);
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
          const activeLimit = Math.min(2, Math.max(1, Math.ceil(videos.length * 0.2)));
          randomSample(videos.filter((video) => !video.paused && !manualVideos.has(video)), videos.length).slice(activeLimit).forEach(stopVideo);
          randomSample(videos.filter((video) => video.paused && !manualVideos.has(video)), activeLimit).forEach((video) => {
            if (Math.random() < 0.76) {
              playVideo(video);
              window.setTimeout(() => {
                if (!manualVideos.has(video) && visibleVideos.has(video) && Math.random() < 0.88) stopVideo(video);
              }, 460 + Math.random() * 2100);
            }
          });
          videos.forEach((video) => {
            if (!manualVideos.has(video) && !video.paused && Math.random() < 0.28) stopVideo(video);
          });
          scheduleChaos();
        }
        document.querySelectorAll(".library-card").forEach((card) => {
          const video = card.querySelector(".library-card-webm");
          if (!video) return;
          card.addEventListener("pointerenter", () => startHoverLoop(video));
          card.addEventListener("focusin", () => startHoverLoop(video));
          card.addEventListener("pointerleave", () => stopHoverLoop(video));
          card.addEventListener("focusout", () => stopHoverLoop(video));
        });
        if ("IntersectionObserver" in window) {
          const observer = new IntersectionObserver((entries) => {
            entries.forEach((entry) => {
              const video = entry.target.querySelector(".library-card-webm");
              if (!video) return;
              if (entry.isIntersecting && entry.intersectionRatio >= 0.42) {
                visibleVideos.add(video);
                warmVideoMetadata(video);
              } else {
                visibleVideos.delete(video);
                if (!manualVideos.has(video)) stopVideo(video);
              }
            });
            scheduleChaos();
          }, { threshold: [0, 0.42, 0.68, 1] });
          document.querySelectorAll(".library-card").forEach((card) => observer.observe(card));
        } else {
          document.querySelectorAll(".library-card-webm").forEach((video) => visibleVideos.add(video));
        }
        document.addEventListener("visibilitychange", () => {
          if (document.hidden) {
            window.clearTimeout(chaosTimer);
            visibleVideos.forEach((video) => { if (!manualVideos.has(video)) stopVideo(video); });
          } else {
            scheduleChaos();
          }
        });
        window.addEventListener("pagehide", () => {
          window.clearTimeout(chaosTimer);
          visibleVideos.forEach(stopVideo);
        }, { once: true });
        scheduleChaos();
      }
      installChaoticCardPlayback();
    </script>
    <script>window.SpineLinkMetricsConfig = {};</script>
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

  const requestedPublicOwnerId = String(request.query?.user || '').trim();
  const publicOwnerId = legacyPublicOwnerAliases[requestedPublicOwnerId] || requestedPublicOwnerId;
  if (!/^u_[a-z0-9]{3,32}$/i.test(requestedPublicOwnerId)) return response.status(400).send('Invalid public library');

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
    const metricsText = await githubText(settings, `${settings.basePath}/metrics.json`);
    const metrics = parseMetricsJson(metricsText);
    const allEntries = indexText ? JSON.parse(indexText) : [];
    const entries = Array.isArray(allEntries)
      ? allEntries.filter((entry) => String(entry?.publicOwnerId || '') === publicOwnerId)
      : [];
    entries.sort(compareLibraryEntries);
    const { visibleEntries, isPortfolioMode } = indexablePortfolioState(entries);
    const robotsTag = isPortfolioMode && visibleEntries.length > 0
      ? 'index, follow, max-image-preview:large, max-video-preview:-1, max-snippet:-1'
      : 'noindex, follow';

    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.setHeader('X-Robots-Tag', robotsTag);
    setCacheHeaders(response, cacheProfiles.dynamicHtmlBrowser, cacheProfiles.dynamicHtmlCdn);
    if (request.method === 'HEAD') {
      return response.status(200).send('');
    }
    return response.status(200).send(createLibraryHtml({ origin, publicOwnerId, entries, metrics }));
  } catch (error) {
    return response.status(500).send(error instanceof Error ? error.message : 'Library failed');
  }
}
