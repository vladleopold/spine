import { cacheProfiles, setCacheHeaders } from '../lib/cache-headers.js';
import { cachedGithubText } from '../lib/github-content-cache.js';

const defaultOwner = 'vladleopold';
const defaultRepo = 'spine';
const defaultBranch = 'main';
const defaultBasePath = 'library';

function cleanRepoPath(value = '') {
  return String(value).trim().replace(/^\/+|\/+$/g, '').replace(/\/+/g, '/');
}

function base64ToBuffer(base64) {
  return Buffer.from(String(base64).replace(/\s/g, ''), 'base64');
}

async function githubText(settings, path) {
  return cachedGithubText(settings, path);
}

export default async function handler(request, response) {
  if (request.method !== 'GET' && request.method !== 'HEAD') {
    response.setHeader('Allow', 'GET, HEAD');
    return response.status(405).send('Method not allowed');
  }

  const type = String(request.query?.type || request.url?.includes('preview-webm') ? 'webm' : 'thumbnail').trim();
  const id = String(request.query?.id || '').trim();

  if (type === 'webm') {
    setCacheHeaders(response, cacheProfiles.mediaBrowser, cacheProfiles.mediaCdn);
    return response.redirect(307, '/spine-link.webm');
  }

  if (!id || !/^[a-z0-9][a-z0-9._-]{0,160}$/i.test(id)) {
    return response.status(400).send('Invalid thumbnail id');
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

  try {
    const indexText = await githubText(settings, `${settings.basePath}/index.json`);
    const entries = indexText ? JSON.parse(indexText) : [];
    const entry = Array.isArray(entries) ? entries.find((item) => String(item?.id || '') === id) : null;
    const poster = String(entry?.thumbnailPoster || '');
    const match = poster.match(/^data:image\/webp;base64,([\s\S]+)$/i);
    if (!match) return response.status(404).send('Generated thumbnail not found');

    const thumbnail = base64ToBuffer(match[1]);
    response.setHeader('Content-Type', 'image/webp');
    response.setHeader('Content-Length', String(thumbnail.length));
    setCacheHeaders(response, cacheProfiles.immutable, cacheProfiles.immutableCdn);
    if (request.method === 'HEAD') return response.status(200).end();
    return response.status(200).send(thumbnail);
  } catch (error) {
    return response.status(500).send(error instanceof Error ? error.message : 'Generated thumbnail failed');
  }
}
