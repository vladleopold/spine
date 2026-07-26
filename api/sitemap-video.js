const defaultOwner = 'vladleopold';
const defaultRepo = 'spine';
const defaultBranch = 'main';
const defaultBasePath = 'library';
import { appendAssetVersion, assetVersionForEntry } from '../lib/asset-version.js';
import { cachedGithubText } from '../lib/github-content-cache.js';
import { cacheProfiles, setCacheHeaders } from '../lib/cache-headers.js';

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

function cleanPublicText(value = '', maxLength = 240) {
  return String(value).trim().replace(/\s+/g, ' ').slice(0, maxLength);
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

function durationSeconds(value) {
  const seconds = Number(value);
  if (!Number.isFinite(seconds) || seconds <= 0) return '';
  return String(Math.max(1, Math.round(seconds)));
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

function spinePlayerUrl(origin, entry) {
  const id = encodeURIComponent(String(entry?.id || '').trim());
  const animation = String(entry?.defaultAnimation || '').trim();
  return animation ? `${origin}/p/${id}?animation=${encodeURIComponent(animation)}` : `${origin}/p/${id}`;
}

function videoWatchUrl(origin, entry) {
  const id = encodeURIComponent(String(entry?.id || '').trim());
  return `${origin}/video/${id}`;
}

function videoTagsXml(tags = []) {
  return (Array.isArray(tags) ? tags : [])
    .map((tag) => cleanPublicText(tag, 32))
    .filter(Boolean)
    .slice(0, 32)
    .map((tag) => `      <video:tag>${escapeXml(tag)}</video:tag>`)
    .join('\n');
}

function videoOnlyXml({ loc, player, thumbnail, title, description, content, publicationDate, duration, uploader, tags, gallery }) {
  const tagsXml = videoTagsXml(tags);
  const playerLoc = player || loc;
  const galleryXml = gallery?.loc
    ? `      <video:gallery_loc${gallery.title ? ` title="${escapeXml(gallery.title)}"` : ''}>${escapeXml(gallery.loc)}</video:gallery_loc>\n`
    : '';
  return `    <video:video>
      <video:thumbnail_loc>${escapeXml(thumbnail)}</video:thumbnail_loc>
      <video:title>${escapeXml(title)}</video:title>
      <video:description>${escapeXml(description)}</video:description>
      <video:content_loc>${escapeXml(content)}</video:content_loc>
      <video:player_loc allow_embed="yes">${escapeXml(playerLoc)}</video:player_loc>
      <video:publication_date>${escapeXml(publicationDate)}</video:publication_date>
${duration ? `      <video:duration>${escapeXml(duration)}</video:duration>\n` : ''}${uploader ? `      <video:uploader>${escapeXml(uploader)}</video:uploader>\n` : ''}${galleryXml}      <video:family_friendly>yes</video:family_friendly>
      <video:category>Spine animation portfolio</video:category>
${tagsXml ? `${tagsXml}\n` : ''}      <video:requires_subscription>no</video:requires_subscription>
      <video:live>no</video:live>
    </video:video>`;
}

function videoUrlXml(entry) {
  if (Array.isArray(entry?.videos)) {
    return `  <url>
    <loc>${escapeXml(entry.loc)}</loc>
${entry.videos.map((video) => videoOnlyXml({ ...video, loc: entry.loc })).join('\n')}
  </url>`;
  }
  return `  <url>
    <loc>${escapeXml(entry.loc)}</loc>
${videoOnlyXml(entry)}
  </url>`;
}

function staticVideoEntries(origin) {
  return [
    {
      loc: `${origin}/spine-link-video.html`,
      thumbnail: `${origin}/spine-link-video-thumbnail.png`,
      title: 'Spine-Link online Spine preview video demo',
      description: 'Demo of Spine-Link, an online Spine preview and Spine web viewer for JSON, SKEL, atlas, and texture files.',
      content: `${origin}/spine-link.webm`,
      publicationDate: '2026-05-01T17:20:00.000Z',
      gallery: { loc: `${origin}/world-spine-archive`, title: 'World SPINE ARCHIVE' },
      tags: ['Spine', 'Spine animation', 'Spine preview', 'Spine web viewer', 'animation portfolio'],
    },
    {
      loc: `${origin}/spine-online-video.html`,
      thumbnail: `${origin}/video_tumbnail.png`,
      title: 'Spine online browser animation preview video',
      description: 'Spine online video demo of Spine-Link, a browser Spine animation preview and Spine web viewer for permanent preview links.',
      content: `${origin}/spine-online.webm`,
      publicationDate: '2026-05-01T18:49:00.000Z',
      gallery: { loc: `${origin}/world-spine-archive`, title: 'World SPINE ARCHIVE' },
      tags: ['Spine online', 'Spine animation', 'WebM preview', 'animation portfolio'],
    },
  ];
}

function libraryVideoEntries(origin, entries, exclusions = { rules: [] }) {
  return entries
    .filter((entry) => entry && entry.hiddenFromPublicLibrary !== true && !entryExcludedFromArchive(entry, exclusions))
    .map((entry) => {
      const id = String(entry.id || '').trim();
      const content = entryVideoAsset(entry.webmPreview || '', entry, 'webm');
      const thumbnail = entryImageAsset(entry.thumbnailPoster || '', entry, 'poster') || generatedThumbnailUrl(origin, entry) || entryImageAsset(entry.thumbnail || '', entry, 'thumbnail');
      if (!id || !content || !thumbnail || content.endsWith('/v_holder.webm')) return null;
      const title = cleanPublicText(entry.title || id || 'Spine animation preview', 100);
      const watchLoc = spinePlayerUrl(origin, entry);
      return {
        loc: watchLoc,
        player: watchLoc,
        thumbnail,
        title: `${title} - World SPINE ARCHIVE Spine animation video`,
        description:
          cleanPublicText(entry.note || `${title} public user Spine animation work with WebM video preview, thumbnail, likes, views, and interactive Spine player on Spine Portfolio.`, 240) ||
          `${title} public user Spine animation work with WebM video preview, thumbnail, likes, views, and interactive Spine player on Spine Portfolio.`,
        content,
        publicationDate: isoDate(entry.uploadedAt) || '2026-05-04T00:00:00.000Z',
        duration: durationSeconds(entry.previewDuration),
        uploader: cleanPublicText(entry.ownerName || 'Spine-Link creator', 80),
        gallery: { loc: `${origin}/world-spine-archive/${encodeURIComponent(id)}`, title: `${title} archive detail` },
        tags: [
          'Spine',
          'Spine animation',
          'World SPINE ARCHIVE',
          'public user work',
          entry?.portfolioMode === true ? 'portfolio' : 'library',
          ...(Array.isArray(entry?.animations) ? entry.animations.slice(0, 8) : []),
        ],
      };
    })
    .filter(Boolean);
}

function publicPortfolioEntries(entries) {
  return (Array.isArray(entries) ? entries : []).filter((entry) => {
    const publicOwnerId = String(entry?.publicOwnerId || '');
    const content = entryVideoAsset(entry?.webmPreview || '', entry, 'webm');
    return (
      /^u_[a-z0-9]{3,32}$/i.test(publicOwnerId) &&
      entry?.portfolioMode === true &&
      entry?.hiddenFromPublicLibrary !== true &&
      Boolean(content) &&
      !content.endsWith('/v_holder.webm')
    );
  });
}

function portfolioVideoEntries(origin, entries) {
  const groups = new Map();
  for (const entry of publicPortfolioEntries(entries)) {
    const ownerId = String(entry.publicOwnerId || '');
    const current = groups.get(ownerId) || [];
    current.push(entry);
    groups.set(ownerId, current);
  }

  const urls = [];
  for (const [ownerId, ownerEntries] of groups) {
    ownerEntries.sort((a, b) => String(b?.uploadedAt || '').localeCompare(String(a?.uploadedAt || '')));
    const ownerName = cleanPublicText(ownerEntries[0]?.ownerName || 'Spine-Link creator', 80);
    const videos = ownerEntries.slice(0, 20).map((entry) => {
      const id = String(entry.id || '').trim();
      const title = cleanPublicText(entry.title || id || 'Spine animation preview', 100);
      return {
        thumbnail: entryImageAsset(entry.thumbnailPoster || '', entry, 'poster') || generatedThumbnailUrl(origin, entry) || entryImageAsset(entry.thumbnail || '', entry, 'thumbnail'),
        title: `${title} portfolio video by ${ownerName}`,
        description:
          cleanPublicText(entry.note || `${title} video preview inside ${ownerName}'s public Spine animation portfolio on Spine-Link.`, 240) ||
          `${title} video preview inside ${ownerName}'s public Spine animation portfolio on Spine-Link.`,
        content: entryVideoAsset(entry.webmPreview || '', entry, 'webm'),
        publicationDate: isoDate(entry.uploadedAt) || '2026-05-04T00:00:00.000Z',
        duration: durationSeconds(entry.previewDuration),
        uploader: ownerName,
        tags: ['Spine', 'Spine animation portfolio', ownerName, ...(Array.isArray(entry?.animations) ? entry.animations.slice(0, 8) : [])],
      };
    }).filter((video) => video.thumbnail && video.content);
    if (!videos.length) continue;
    urls.push({
      loc: `${origin}/u/${encodeURIComponent(ownerId)}`,
      videos,
    });
  }
  return urls;
}

export default async function handler(request, response) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.setHeader('Allow', 'GET, HEAD');
    return response.status(405).send('Method not allowed');
  }

  const origin = 'https://spine-link.vercel.app';
  const token = process.env.GITHUB_TOKEN;
  let dynamicEntries = [];

  if (token) {
    const settings = {
      owner: process.env.GITHUB_OWNER || defaultOwner,
      repo: process.env.GITHUB_REPO || defaultRepo,
      branch: process.env.GITHUB_BRANCH || defaultBranch,
      basePath: cleanRepoPath(process.env.GITHUB_BASE_PATH || defaultBasePath),
      token,
    };
    try {
      const indexText = await githubText(settings, `${settings.basePath}/index.json`);
      const exclusionsText = await githubText(settings, `${settings.basePath}/archive-exclusions.json`);
      const entries = indexText ? JSON.parse(indexText) : [];
      const exclusions = exclusionsText ? JSON.parse(exclusionsText) : { rules: [] };
      dynamicEntries = Array.isArray(entries) ? libraryVideoEntries(origin, entries, exclusions) : [];
    } catch {
      dynamicEntries = [];
    }
  }

  const urls = [...staticVideoEntries(origin), ...dynamicEntries].map(videoUrlXml).join('\n');
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset
  xmlns="http://www.sitemaps.org/schemas/sitemap/0.9"
  xmlns:video="http://www.google.com/schemas/sitemap-video/1.1"
>
${urls}
</urlset>
`;

  response.setHeader('Content-Type', 'application/xml; charset=utf-8');
  setCacheHeaders(response, cacheProfiles.sitemapBrowser, cacheProfiles.sitemapCdn);
  if (request.method === 'HEAD') return response.status(200).end();
  return response.status(200).send(xml);
}
