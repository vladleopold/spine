const defaultOwner = 'vladleopold';
const defaultRepo = 'spine';
const defaultBranch = 'main';

function cleanRepoPath(value = '') {
  return String(value).trim().replace(/^\/+|\/+$/g, '').replace(/\/+/g, '/');
}

function base64ToBuffer(base64) {
  return Buffer.from(String(base64).replace(/\s/g, ''), 'base64');
}

function contentTypeFor(path) {
  const lowerPath = path.toLowerCase();
  if (lowerPath.endsWith('.json')) return 'application/json; charset=utf-8';
  if (lowerPath.endsWith('.atlas') || lowerPath.endsWith('.atlas.txt') || lowerPath.endsWith('.atlas.docx')) return 'text/plain; charset=utf-8';
  if (lowerPath.endsWith('.png')) return 'image/png';
  if (lowerPath.endsWith('.jpg') || lowerPath.endsWith('.jpeg')) return 'image/jpeg';
  if (lowerPath.endsWith('.webp')) return 'image/webp';
  if (lowerPath.endsWith('.skel')) return 'application/octet-stream';
  return 'application/octet-stream';
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
    const buffer = base64ToBuffer(data.content || '');
    response.setHeader('Content-Type', contentTypeFor(path));
    response.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    return response.status(200).send(buffer);
  } catch (error) {
    return response.status(500).send(error instanceof Error ? error.message : 'Asset failed');
  }
}
