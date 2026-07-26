const defaultOwner = 'vladleopold';
const defaultRepo = 'spine';
const defaultBranch = 'main';
const defaultBasePath = 'library';
import { cachedGithubText } from '../lib/github-content-cache.js';
import { cacheProfiles, setCacheHeaders } from '../lib/cache-headers.js';

function cleanRepoPath(value = '') {
  return String(value).trim().replace(/^\/+|\/+$/g, '').replace(/\/+/g, '/');
}

function encodeRepoPath(path) {
  return cleanRepoPath(path)
    .split('/')
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join('/');
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

function publicPortfolioEntries(entries, exclusions) {
  return (Array.isArray(entries) ? entries : []).filter((entry) => {
    const publicOwnerId = String(entry?.publicOwnerId || '');
    const id = String(entry?.id || '').trim();
    return id
      && /^u_[a-z0-9]{3,32}$/i.test(publicOwnerId)
      && entry?.portfolioMode === true
      && entry?.hiddenFromPublicLibrary !== true
      && !entryExcludedFromArchive(entry, exclusions);
  });
}

function spinePlayerUrl(origin, entry) {
  const id = encodeURIComponent(String(entry?.id || '').trim());
  if (!id) return '';
  const animation = String(entry?.defaultAnimation || '').trim();
  return animation ? `${origin}/p/${id}?animation=${encodeURIComponent(animation)}` : `${origin}/p/${id}`;
}

export default async function handler(request, response) {
  if (!['GET', 'HEAD'].includes(request.method)) {
    response.setHeader('Allow', 'GET, HEAD');
    return response.status(405).send('Method not allowed');
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) return response.status(500).send('GITHUB_TOKEN is not configured');

  const origin = 'https://spine-link.vercel.app';
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
    const allEntries = indexText ? JSON.parse(indexText) : [];
    const exclusions = exclusionsText ? JSON.parse(exclusionsText) : { rules: [] };
    const entries = publicPortfolioEntries(allEntries, exclusions).sort(compareLibraryEntries);
    const groups = new Map();

    for (const entry of entries) {
      const ownerId = String(entry.publicOwnerId || '');
      const current = groups.get(ownerId) || [];
      current.push(entry);
      groups.set(ownerId, current);
    }

    const urls = [];
    for (const [ownerId, ownerEntries] of groups) {
      const newestEntry = [...ownerEntries].sort((a, b) => String(b?.uploadedAt || '').localeCompare(String(a?.uploadedAt || '')))[0];
      urls.push({
        loc: `${origin}/u/${encodeURIComponent(ownerId)}`,
        lastmod: validDate(newestEntry?.uploadedAt),
        changefreq: 'weekly',
        priority: '0.9',
      });
      for (const entry of ownerEntries) {
        const id = String(entry?.id || '').trim();
        if (!id) continue;
        const lastmod = validDate(entry?.uploadedAt);
        urls.push({
          loc: `${origin}/world-spine-archive/${encodeURIComponent(id)}`,
          lastmod,
          changefreq: 'monthly',
          priority: '0.78',
        });
        const playerUrl = spinePlayerUrl(origin, entry);
        if (playerUrl) {
          urls.push({
            loc: playerUrl,
            lastmod,
            changefreq: 'monthly',
            priority: '0.76',
          });
        }
      }
    }

    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">
${urls.map((url) => `  <url>
    <loc>${escapeXml(url.loc)}</loc>
    <lastmod>${escapeXml(url.lastmod)}</lastmod>
    <changefreq>${escapeXml(url.changefreq)}</changefreq>
    <priority>${escapeXml(url.priority)}</priority>
  </url>`).join('\n')}
</urlset>
`;

    response.setHeader('Content-Type', 'application/xml; charset=utf-8');
    setCacheHeaders(response, cacheProfiles.sitemapBrowser, cacheProfiles.sitemapCdn);
    if (request.method === 'HEAD') return response.status(200).send('');
    return response.status(200).send(xml);
  } catch (error) {
    return response.status(500).send(error instanceof Error ? error.message : 'Portfolio sitemap failed');
  }
}
