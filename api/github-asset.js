const defaultOwner = 'vladleopold';
const defaultRepo = 'spine';
const defaultBranch = 'main';

function cleanRepoPath(value = '') {
  return String(value).trim().replace(/^\/+|\/+$/g, '').replace(/\/+/g, '/');
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
  if (lowerPath.endsWith('.jpg') || lowerPath.endsWith('.jpeg')) return 'image/jpeg';
  if (lowerPath.endsWith('.webp')) return 'image/webp';
  if (lowerPath.endsWith('.webm')) return 'video/webm';
  if (lowerPath.endsWith('.html')) return 'text/html; charset=utf-8';
  if (lowerPath.endsWith('.xml')) return 'application/xml; charset=utf-8';
  if (lowerPath.endsWith('.txt')) return 'text/plain; charset=utf-8';
  if (lowerPath.endsWith('.skel')) return 'application/octet-stream';
  return 'application/octet-stream';
}

function isAtlasPath(path) {
  const lowerPath = path.toLowerCase();
  return lowerPath.endsWith('.atlas') || lowerPath.endsWith('.atlas.txt') || lowerPath.endsWith('.atlas.docx');
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

export default async function handler(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return response.status(405).send('Method not allowed');
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) return response.status(500).send('GITHUB_TOKEN is not configured');

  const path = cleanRepoPath(request.query?.path || '');
  if (!path) return response.status(400).send('Invalid asset path');
  const assetVersion = typeof request.query?.v === 'string' ? request.query.v : '';

  const owner = process.env.GITHUB_OWNER || defaultOwner;
  const repo = process.env.GITHUB_REPO || defaultRepo;
  const branch = process.env.GITHUB_BRANCH || defaultBranch;
  const encodedPath = encodeURIComponent(path).replace(/%2F/g, '/');

  try {
    const githubResponse = await fetch(`https://api.github.com/repos/${owner}/${repo}/contents/${encodedPath}?ref=${encodeURIComponent(branch)}`, {
      headers: githubHeaders(token),
    });

    if (!githubResponse.ok) return response.status(githubResponse.status).send('Asset not found');

    const data = await githubResponse.json();
    let buffer = await contentBufferFromGitHubContent(data, token);
    if (!buffer.length) return response.status(404).send('Asset is empty');
    if (isAtlasPath(path)) {
      buffer = withAtlasPageCacheBuster(buffer, assetVersion);
    }
    response.setHeader('Content-Type', contentTypeFor(path));
    response.setHeader('Cache-Control', assetVersion ? 'public, max-age=31536000, immutable' : 'public, max-age=3600, stale-while-revalidate=86400');
    return response.status(200).send(buffer);
  } catch (error) {
    return response.status(500).send(error instanceof Error ? error.message : 'Asset failed');
  }
}
