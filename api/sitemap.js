const defaultOwner = 'vladleopold';
const defaultRepo = 'spine';
const defaultBranch = 'main';
const defaultBasePath = 'library';
const origin = 'https://spine-link.vercel.app';
import { cachedGithubText } from '../lib/github-content-cache.js';
import { cacheProfiles, setCacheHeaders } from '../lib/cache-headers.js';
import { appendAssetVersion, assetVersionForEntry } from '../lib/asset-version.js';

function entryImageAssetUrl(value = '', entry = {}) {
  const url = String(value).trim();
  return /^https:\/\/[^\s"'<>]+$/i.test(url) ? url : '';
}

function entryVideoAssetUrl(value = '', entry = {}) {
  const url = String(value).trim();
  return /^https:\/\/[^\s"'<>]+$/i.test(url) ? appendAssetVersion(url, assetVersionForEntry(entry, 'webm')) : '';
}

const staticUrls = [
  { loc: 'https://spine-link.vercel.app/', lastmod: '2026-05-12', changefreq: 'weekly', priority: '1.0' },
  { loc: 'https://spine-link.vercel.app/spine-link.html', lastmod: '2026-05-12', changefreq: 'weekly', priority: '0.9' },
  { loc: 'https://spine-link.vercel.app/spine-preview.html', lastmod: '2026-05-12', changefreq: 'weekly', priority: '0.9' },
  { loc: 'https://spine-link.vercel.app/spine-preview-online.html', lastmod: '2026-05-12', changefreq: 'weekly', priority: '0.9' },
  { loc: 'https://spine-link.vercel.app/spine-web-viewer.html', lastmod: '2026-05-12', changefreq: 'weekly', priority: '0.9' },
  { loc: 'https://spine-link.vercel.app/spine-animation-preview.html', lastmod: '2026-05-12', changefreq: 'weekly', priority: '0.9' },
  { loc: 'https://spine-link.vercel.app/spine-animation-dataset.html', lastmod: '2026-05-12', changefreq: 'monthly', priority: '0.8' },
  { loc: 'https://spine-link.vercel.app/spine-link-manifesto.html', lastmod: '2026-05-12', changefreq: 'monthly', priority: '0.86' },
  { loc: 'https://spine-link.vercel.app/spine-library.html', lastmod: '2026-05-12', changefreq: 'weekly', priority: '0.85' },
  { loc: 'https://spine-link.vercel.app/spine-portfolio.html', lastmod: '2026-05-12', changefreq: 'weekly', priority: '0.85' },
  { loc: 'https://spine-link.vercel.app/share-spine-animation-link.html', lastmod: '2026-05-12', changefreq: 'weekly', priority: '0.86' },
  { loc: 'https://spine-link.vercel.app/spine-portfolio-link.html', lastmod: '2026-05-12', changefreq: 'weekly', priority: '0.84' },
  { loc: 'https://spine-link.vercel.app/spine-animator.html', lastmod: '2026-05-12', changefreq: 'weekly', priority: '0.8' },
  { loc: 'https://spine-link.vercel.app/spine-animations.html', lastmod: '2026-05-12', changefreq: 'weekly', priority: '0.8' },
  { loc: 'https://spine-link.vercel.app/spine-work.html', lastmod: '2026-05-12', changefreq: 'weekly', priority: '0.8' },
  { loc: 'https://spine-link.vercel.app/spine-link-video.html', lastmod: '2026-05-12', changefreq: 'monthly', priority: '0.8' },
  { loc: 'https://spine-link.vercel.app/spine-online-video.html', lastmod: '2026-05-12', changefreq: 'monthly', priority: '0.8' },
  { loc: 'https://spine-link.vercel.app/world-spine-archive', lastmod: '2026-05-12', changefreq: 'daily', priority: '0.95' },
  { loc: 'https://spine-link.vercel.app/spne-lib.html', lastmod: '2026-05-12', changefreq: 'monthly', priority: '0.65' },
  { loc: 'https://spine-link.vercel.app/site-map.html', lastmod: '2026-05-12', changefreq: 'weekly', priority: '0.8' },
  { loc: 'https://spine-link.vercel.app/amp.html', lastmod: '2026-05-12', changefreq: 'weekly', priority: '0.8' },
];

function cleanRepoPath(value = '') {
  return String(value).trim().replace(/^\/+|\/+$/g, '').replace(/\/+/g, '/');
}

function base64ToText(base64) {
  return Buffer.from(String(base64).replace(/\s/g, ''), 'base64').toString('utf8');
}

function escapeXml(value = '') {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
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

function validDate(value, fallback = '2026-05-12') {
  const date = new Date(String(value || ''));
  return Number.isNaN(date.getTime()) ? fallback : date.toISOString().slice(0, 10);
}

function cleanPublicText(value = '', maxLength = 160) {
  return String(value).replace(/\s+/g, ' ').trim().slice(0, maxLength);
}

function safeImage(value = '') {
  const url = String(value).trim();
  return /^https:\/\/[^\s"'<>]+$/i.test(url) ? url : '';
}

function generatedThumbnailUrl(entry) {
  const id = String(entry?.id || '').trim();
  const poster = String(entry?.thumbnailPoster || '');
  return id && /^data:image\/webp;base64,/i.test(poster)
    ? `${origin}/assets/library/${encodeURIComponent(id)}/generated-preview.webp`
    : '';
}

function entryImageUrl(entry) {
  const isGifThumbnail = entry?.thumbnailType === 'gif' || /^data:image\/gif;base64,/i.test(String(entry?.thumbnail || ''));
  return safeImage(entry?.thumbnailPoster || '') || generatedThumbnailUrl(entry) || (isGifThumbnail ? '' : safeImage(entry?.thumbnail || ''));
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

function archiveEntries(entries, exclusions) {
  return (Array.isArray(entries) ? entries : [])
    .filter((entry) => (
      entry?.hiddenFromPublicLibrary !== true &&
      (entry?.webmPreview || entry?.thumbnail || entry?.thumbnailPoster) &&
      !entryExcludedFromArchive(entry, exclusions)
    ))
    .sort((a, b) => String(b?.uploadedAt || '').localeCompare(String(a?.uploadedAt || '')));
}

function spinePlayerUrl(entry) {
  const id = encodeURIComponent(String(entry?.id || '').trim());
  if (!id) return '';
  const animation = String(entry?.defaultAnimation || '').trim();
  return animation ? `${origin}/p/${id}?animation=${encodeURIComponent(animation)}` : `${origin}/p/${id}`;
}

function urlXml(url) {
  return `  <url>
    <loc>${escapeXml(url.loc)}</loc>
    <lastmod>${escapeXml(url.lastmod)}</lastmod>
    <changefreq>${escapeXml(url.changefreq)}</changefreq>
    <priority>${escapeXml(url.priority)}</priority>
  </url>`;
}

function sitemapXml(urls) {
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map(urlXml).join('\n')}
</urlset>
`;

  return xml;
}

function isArchiveRequest(request) {
  const requestUrl = new URL(request.url || '/', origin);
  return requestUrl.searchParams.get('kind') === 'archive' || requestUrl.pathname.endsWith('/sitemap-archive.xml');
}

function isImagesRequest(request) {
  const requestUrl = new URL(request.url || '/', origin);
  return requestUrl.searchParams.get('kind') === 'images' || requestUrl.pathname.endsWith('/sitemap-images.xml');
}

function isIndexRequest(request) {
  const requestUrl = new URL(request.url || '/', origin);
  return requestUrl.searchParams.get('kind') === 'index' || requestUrl.pathname.endsWith('/sitemap-index.xml');
}

function isPortfoliosRequest(request) {
  const requestUrl = new URL(request.url || '/', origin);
  return requestUrl.searchParams.get('kind') === 'portfolios' || requestUrl.pathname.endsWith('/sitemap-portfolios.xml');
}

function isVideoRequest(request) {
  const requestUrl = new URL(request.url || '/', origin);
  return requestUrl.searchParams.get('kind') === 'video' || requestUrl.pathname.endsWith('/sitemap-video.xml');
}

async function publicArchiveEntries() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN is not configured');

  const settings = {
    owner: process.env.GITHUB_OWNER || defaultOwner,
    repo: process.env.GITHUB_REPO || defaultRepo,
    branch: process.env.GITHUB_BRANCH || defaultBranch,
    basePath: cleanRepoPath(process.env.GITHUB_BASE_PATH || defaultBasePath),
    token,
  };

  const indexText = await githubText(settings, `${settings.basePath}/index.json`);
  const exclusionsText = await githubText(settings, `${settings.basePath}/archive-exclusions.json`);
  return archiveEntries(indexText ? JSON.parse(indexText) : [], exclusionsText ? JSON.parse(exclusionsText) : { rules: [] });
}

async function archiveSitemapXml() {
  const entries = await publicArchiveEntries();
  const newest = entries[0];
  const urls = [
    {
      loc: `${origin}/world-spine-archive`,
      lastmod: validDate(newest?.uploadedAt),
      changefreq: 'daily',
      priority: '0.95',
    },
    ...entries.slice(0, 2000).flatMap((entry) => {
      const id = String(entry?.id || '').trim();
      if (!id) return [];
      const lastmod = validDate(entry?.uploadedAt);
      const priority = entry?.portfolioMode === true ? '0.78' : '0.68';
      const urls = [
        {
          loc: `${origin}/world-spine-archive/${encodeURIComponent(id)}`,
          lastmod,
          changefreq: 'monthly',
          priority,
        },
      ];
      const playerUrl = spinePlayerUrl(entry);
      if (playerUrl) {
        urls.push({
          loc: playerUrl,
          lastmod,
          changefreq: 'monthly',
          priority: entry?.portfolioMode === true ? '0.76' : '0.66',
        });
      }
      return urls;
    }),
  ];

  return sitemapXml(urls);
}

function imageUrlXml(entry) {
  const id = String(entry?.id || '').trim();
  const image = entryImageUrl(entry);
  if (!id || !image) return '';
  const title = cleanPublicText(entry?.title || id || 'Spine animation preview image', 120);
  const caption = cleanPublicText(
    entry?.note || `${title} poster image for a public Spine animation work in World SPINE ARCHIVE.`,
    240,
  );
  return `  <url>
    <loc>${escapeXml(`${origin}/world-spine-archive/${encodeURIComponent(id)}`)}</loc>
    <image:image>
      <image:loc>${escapeXml(image)}</image:loc>
      <image:title>${escapeXml(`${title} Spine animation preview image`)}</image:title>
      <image:caption>${escapeXml(caption)}</image:caption>
    </image:image>
  </url>`;
}

async function imagesSitemapXml() {
  const entries = await publicArchiveEntries();
  const imageUrls = entries.slice(0, 2000).map(imageUrlXml).filter(Boolean).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>
<urlset
  xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
  xmlns:image="http://www.google.com/schemas/sitemap-image/1.1"
>
${imageUrls}
</urlset>
`;
}

function indexSitemapXml() {
  return `<?xml version="1.0" encoding="UTF-8"?>
<sitemapindex xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
  <sitemap>
    <loc>https://spine-link.vercel.app/sitemap.xml</loc>
    <lastmod>2026-05-12</lastmod>
  </sitemap>
  <sitemap>
    <loc>https://spine-link.vercel.app/sitemap-portfolios.xml</loc>
    <lastmod>2026-05-12</lastmod>
  </sitemap>
  <sitemap>
    <loc>https://spine-link.vercel.app/sitemap-archive.xml</loc>
    <lastmod>2026-05-12</lastmod>
  </sitemap>
  <sitemap>
    <loc>https://spine-link.vercel.app/sitemap-video.xml</loc>
    <lastmod>2026-05-12</lastmod>
  </sitemap>
  <sitemap>
    <loc>https://spine-link.vercel.app/sitemap-images.xml</loc>
    <lastmod>2026-05-12</lastmod>
  </sitemap>
</sitemapindex>
`;
}

function validDate(value, fallback = '2026-05-12') {
  const date = new Date(String(value || ''));
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toISOString().slice(0, 10);
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

function textFromEntry(entry, field = 'all') {
  if (!entry || typeof entry !== 'object') return '';
  const files = Array.isArray(entry.files) ? entry.files.join(' ') : '';
  const animations = Array.isArray(entry.animations) ? entry.animations.join(' ') : '';
  const values = {
    all: [entry.id, entry.title, entry.ownerEmail, entry.ownerName, entry.note, entry.skeleton, entry.atlas, files, animations, entry.previewPath, entry.repositoryUrl],
    id: [entry.id], title: [entry.title], ownerEmail: [entry.ownerEmail], ownerName: [entry.ownerName], note: [entry.note], files: [files], animations: [animations], path: [entry.previewPath, entry.repositoryUrl],
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
    try { return new RegExp(pattern, String(rule.flags || 'i').replace(/[^dgimsuvy]/g, '') || 'i').test(haystack); } catch { return false; }
  }
  return haystack.toLowerCase().includes(pattern.toLowerCase());
}

function entryExcludedFromArchive(entry, exclusions) {
  return (Array.isArray(exclusions?.rules) ? exclusions.rules : []).some((rule) => exclusionRuleMatches(entry, rule));
}

function publicPortfolioEntries(entries, exclusions) {
  return (Array.isArray(entries) ? entries : []).filter((entry) => {
    const publicOwnerId = String(entry?.publicOwnerId || '');
    const id = String(entry?.id || '').trim();
    return id && /^u_[a-z0-9]{3,32}$/i.test(publicOwnerId) && entry?.portfolioMode === true && entry?.hiddenFromPublicLibrary !== true && !entryExcludedFromArchive(entry, exclusions);
  });
}

async function portfoliosSitemapXml() {
  const token = process.env.GITHUB_TOKEN;
  if (!token) throw new Error('GITHUB_TOKEN is not configured');
  const settings = { owner: process.env.GITHUB_OWNER || defaultOwner, repo: process.env.GITHUB_REPO || defaultRepo, branch: process.env.GITHUB_BRANCH || defaultBranch, basePath: cleanRepoPath(process.env.GITHUB_BASE_PATH || defaultBasePath), token };
  const indexText = await githubText(settings, `${settings.basePath}/index.json`);
  const exclusionsText = await githubText(settings, `${settings.basePath}/archive-exclusions.json`);
  const entries = publicPortfolioEntries(indexText ? JSON.parse(indexText) : [], exclusionsText ? JSON.parse(exclusionsText) : { rules: [] }).sort(compareLibraryEntries);
  const urls = [];
  const groups = new Map();
  for (const entry of entries) {
    const ownerId = String(entry.publicOwnerId || '');
    const current = groups.get(ownerId) || [];
    current.push(entry);
    groups.set(ownerId, current);
  }
  for (const [ownerId, ownerEntries] of groups) {
    const newest = [...ownerEntries].sort((a, b) => String(b?.uploadedAt || '').localeCompare(String(a?.uploadedAt || '')))[0];
    urls.push({ loc: `${origin}/u/${encodeURIComponent(ownerId)}`, lastmod: validDate(newest?.uploadedAt), changefreq: 'weekly', priority: '0.9' });
    for (const entry of ownerEntries) {
      const id = String(entry?.id || '').trim();
      if (!id) continue;
      const lastmod = validDate(entry?.uploadedAt);
      urls.push({ loc: `${origin}/world-spine-archive/${encodeURIComponent(id)}`, lastmod, changefreq: 'monthly', priority: '0.78' });
      const animation = String(entry?.defaultAnimation || '').trim();
      const playerUrl = animation ? `${origin}/p/${encodeURIComponent(id)}?animation=${encodeURIComponent(animation)}` : `${origin}/p/${encodeURIComponent(id)}`;
      urls.push({ loc: playerUrl, lastmod, changefreq: 'monthly', priority: '0.76' });
    }
  }
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.map((u) => `  <url>\n    <loc>${escapeXml(u.loc)}</loc>\n    <lastmod>${escapeXml(u.lastmod)}</lastmod>\n    <changefreq>${escapeXml(u.changefreq)}</changefreq>\n    <priority>${escapeXml(u.priority)}</priority>\n  </url>`).join('\n')}\n</urlset>`;
}

async function videoSitemapXml() {
  const entries = await publicArchiveEntries();
  const urls = entries.filter((e) => e?.webmPreview).slice(0, 2000).map((entry) => {
    const id = String(entry?.id || '').trim();
    if (!id) return '';
    const videoUrl = entryVideoAssetUrl(entry?.webmPreview || '', entry);
    const lastmod = validDate(entry?.uploadedAt);
    const animation = String(entry?.defaultAnimation || '').trim();
    const playerUrl = animation ? `${origin}/p/${encodeURIComponent(id)}?animation=${encodeURIComponent(animation)}` : `${origin}/p/${encodeURIComponent(id)}`;
    return `  <url>\n    <loc>${escapeXml(playerUrl)}</loc>\n    <lastmod>${escapeXml(lastmod)}</lastmod>\n    <video:video>\n      <video:thumbnail_loc>${escapeXml(entryImageAssetUrl(entry?.thumbnailPoster || '', entry))}</video:thumbnail_loc>\n      <video:title>${escapeXml(entry?.title || id)}</video:title>\n      <video:content_loc>${escapeXml(videoUrl)}</video:content_loc>\n      <video:duration>10</video:duration>\n    </video:video>\n  </url>`;
  }).filter(Boolean).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"\n  xmlns:video="http://www.google.com/schemas/sitemap-video/1.1">\n${urls}\n</urlset>`;
}

export default async function handler(request, response) {
  if (!['GET', 'HEAD'].includes(request.method)) {
    response.setHeader('Allow', 'GET, HEAD');
    return response.status(405).send('Method not allowed');
  }

  response.setHeader('Content-Type', 'application/xml; charset=utf-8');
  setCacheHeaders(response, cacheProfiles.sitemapBrowser, cacheProfiles.sitemapCdn);
  if (request.method === 'HEAD') return response.status(200).end();

  let xml;
  try {
    if (isIndexRequest(request)) {
      xml = indexSitemapXml();
    } else if (isArchiveRequest(request)) {
      xml = await archiveSitemapXml();
    } else if (isImagesRequest(request)) {
      xml = await imagesSitemapXml();
    } else if (isPortfoliosRequest(request)) {
      xml = await portfoliosSitemapXml();
    } else if (isVideoRequest(request)) {
      xml = await videoSitemapXml();
    } else {
      xml = sitemapXml(staticUrls);
    }
  } catch (error) {
    return response.status(500).send(error instanceof Error ? error.message : 'Sitemap failed');
  }

  return response.status(200).send(xml);
}
