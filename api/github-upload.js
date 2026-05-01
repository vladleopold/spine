const defaultOwner = 'vladleopold';
const defaultRepo = 'spine';
const defaultBranch = 'main';
const defaultBasePath = 'library';

function cleanRepoPath(value = '') {
  return String(value).trim().replace(/^\/+|\/+$/g, '').replace(/\/+/g, '/');
}

function joinRepoPath(...parts) {
  return parts.map(cleanRepoPath).filter(Boolean).join('/');
}

function textToBase64(text) {
  return Buffer.from(text, 'utf8').toString('base64');
}

function base64ToText(base64) {
  return Buffer.from(String(base64).replace(/\s/g, ''), 'base64').toString('utf8');
}

function encodeRepoPath(path) {
  return cleanRepoPath(path)
    .split('/')
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join('/');
}

function isExternalAsset(value) {
  return /^https?:\/\//i.test(String(value)) || /^data:/i.test(String(value));
}

function normalizePreviewHtml(settings, path, contentBase64, origin) {
  if (!path.endsWith('/preview.html')) return contentBase64;

  try {
    const html = base64ToText(contentBase64);
    const match = html.match(/(<script type="application\/json" id="spine-preview-config">)([\s\S]*?)(<\/script>)/);
    if (!match) return contentBase64;

    const uploadPath = cleanRepoPath(path).replace(/\/preview\.html$/, '');
    const assetUrl = (repoPath) => `${origin}/assets/${encodeRepoPath(repoPath)}`;
    const config = JSON.parse(match[2].replace(/\\u003c/g, '<'));

    for (const set of Array.isArray(config.sets) ? config.sets : []) {
      const setLabel = String(set.label || '');
      const setAssetUrl = (name) => assetUrl(joinRepoPath(uploadPath, setLabel, String(name || '')));

      if (set.skeleton && (!isExternalAsset(set.skeleton) || String(set.skeleton).includes('raw.githubusercontent.com'))) set.skeleton = setAssetUrl(set.skeleton.split('/').pop());
      if (set.atlas && (!isExternalAsset(set.atlas) || String(set.atlas).includes('raw.githubusercontent.com'))) set.atlas = setAssetUrl(set.atlas.split('/').pop());

      if (set.rawDataURIs && typeof set.rawDataURIs === 'object') {
        for (const key of Object.keys(set.rawDataURIs)) {
          if (!isExternalAsset(set.rawDataURIs[key]) || String(set.rawDataURIs[key]).startsWith('data:') || String(set.rawDataURIs[key]).includes('raw.githubusercontent.com')) {
            set.rawDataURIs[key] = setAssetUrl(key);
          }
        }
      }
    }

    const nextJson = JSON.stringify(config).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
    return textToBase64(html.replace(match[0], `${match[1]}${nextJson}${match[3]}`));
  } catch {
    return contentBase64;
  }
}

function githubHeaders(token) {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

function unauthorized(message, statusCode = 401) {
  const error = new Error(message);
  error.statusCode = statusCode;
  return error;
}

async function verifyGoogleToken(request, body) {
  const clientId = process.env.GOOGLE_CLIENT_ID || process.env.VITE_GOOGLE_CLIENT_ID || '';
  const authHeader = request.headers.authorization || request.headers.Authorization || '';
  const bearerToken = String(authHeader).match(/^Bearer\s+(.+)$/i)?.[1] || '';
  const googleToken = bearerToken || String(body?.googleIdToken || '');

  if (!clientId) throw unauthorized('GOOGLE_CLIENT_ID is not configured', 500);
  if (!googleToken) throw unauthorized('Sign in with Google before uploading files');

  const idTokenResponse = await fetch(`https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(googleToken)}`);
  const idPayload = await idTokenResponse.json().catch(() => ({}));

  if (idTokenResponse.ok) {
    if (idPayload.aud !== clientId) throw unauthorized('Google token audience does not match this app');
    if (idPayload.email_verified !== true && idPayload.email_verified !== 'true') throw unauthorized('Google email is not verified');
    return idPayload;
  }

  const accessTokenResponse = await fetch(`https://oauth2.googleapis.com/tokeninfo?access_token=${encodeURIComponent(googleToken)}`);
  const accessPayload = await accessTokenResponse.json().catch(() => ({}));
  if (accessTokenResponse.ok && accessPayload.aud && accessPayload.aud !== clientId) {
    throw unauthorized('Google token audience does not match this app');
  }

  const userResponse = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
    headers: { Authorization: `Bearer ${googleToken}` },
  });
  const userPayload = await userResponse.json().catch(() => ({}));

  if (!userResponse.ok) {
    throw unauthorized(typeof idPayload?.error_description === 'string' ? idPayload.error_description : 'Invalid Google token');
  }

  if (userPayload.email_verified !== true && userPayload.email_verified !== 'true') throw unauthorized('Google email is not verified');

  return userPayload;
}

async function optionalGooglePayload(request, body) {
  const authHeader = request.headers.authorization || request.headers.Authorization || '';
  const bearerToken = String(authHeader).match(/^Bearer\s+(.+)$/i)?.[1] || '';
  const googleToken = bearerToken || String(body?.googleIdToken || '');
  if (!googleToken) return null;
  return verifyGoogleToken(request, body);
}

function normalizeAnonymousAccount(body) {
  const account = body?.anonymousAccount && typeof body.anonymousAccount === 'object' ? body.anonymousAccount : {};
  const id = String(account.id || body?.anonymousAccountId || '').trim();
  const fingerprint = String(account.fingerprint || body?.anonymousFingerprint || '').trim();
  if (!id || !/^anon_[a-z0-9_-]{12,96}$/i.test(id)) return null;
  return { id, fingerprint };
}


function normalizeNote(value = '') {
  const words = String(value)
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 20);
  return words.join(' ');
}

function canEditEntry(entry, googlePayload, anonymousAccount) {
  const userEmail = String(googlePayload?.email || '').toLowerCase();
  const ownerEmail = String(entry?.ownerEmail || '').toLowerCase();
  const anonymousId = String(anonymousAccount?.id || '').toLowerCase();
  const ownerAnonId = String(entry?.ownerAnonId || '').toLowerCase();
  return Boolean((userEmail && ownerEmail === userEmail) || (anonymousId && ownerAnonId === anonymousId));
}

async function getGitHubContent(settings, path) {
  const encodedPath = encodeURIComponent(path).replace(/%2F/g, '/');
  const response = await fetch(`https://api.github.com/repos/${settings.owner}/${settings.repo}/contents/${encodedPath}?ref=${encodeURIComponent(settings.branch)}`, {
    headers: githubHeaders(settings.token),
  });

  if (response.status === 404) return null;
  if (!response.ok) throw new Error(`Storage did not return ${path}: ${response.status}`);

  return response.json();
}

async function putGitHubContent(settings, path, contentBase64, message, sha, origin = '') {
  const encodedPath = encodeURIComponent(path).replace(/%2F/g, '/');
  const normalizedContentBase64 = normalizePreviewHtml(settings, path, contentBase64, origin);
  const response = await fetch(`https://api.github.com/repos/${settings.owner}/${settings.repo}/contents/${encodedPath}`, {
    method: 'PUT',
    headers: {
      ...githubHeaders(settings.token),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message,
      content: normalizedContentBase64,
      branch: settings.branch,
      ...(sha ? { sha } : {}),
    }),
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) {
    throw new Error(typeof result?.message === 'string' ? result.message : `Upload API ${response.status}`);
  }

  return result;
}

async function deleteGitHubContent(settings, path, message, sha) {
  const encodedPath = encodeURIComponent(path).replace(/%2F/g, '/');
  const response = await fetch(`https://api.github.com/repos/${settings.owner}/${settings.repo}/contents/${encodedPath}`, {
    method: 'DELETE',
    headers: {
      ...githubHeaders(settings.token),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      message,
      sha,
      branch: settings.branch,
    }),
  });
  const result = await response.json().catch(() => ({}));
  if (!response.ok && response.status !== 404) {
    throw new Error(typeof result?.message === 'string' ? result.message : `Delete API ${response.status}`);
  }
  return result;
}

async function deleteGitHubPath(settings, path, commitPrefix) {
  const item = await getGitHubContent(settings, path);
  if (!item) return;
  if (Array.isArray(item)) {
    for (const child of item) {
      await deleteGitHubPath(settings, child.path, commitPrefix);
    }
    return;
  }
  if (item.type === 'file' && item.sha) {
    await deleteGitHubContent(settings, item.path || path, `${commitPrefix}: ${item.name || path}`, item.sha);
  }
}

export default async function handler(request, response) {
  if (request.method !== 'POST') {
    response.setHeader('Allow', 'POST');
    return response.status(405).json({ error: 'Method not allowed' });
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) return response.status(500).json({ error: 'GITHUB_TOKEN is not configured' });

  try {
    const origin = `${request.headers['x-forwarded-proto'] || 'https'}://${request.headers['x-forwarded-host'] || request.headers.host}`;
    const body = typeof request.body === 'string' ? JSON.parse(request.body) : request.body;
    const googlePayload = await optionalGooglePayload(request, body);
    const anonymousAccount = normalizeAnonymousAccount(body);

    const settings = {
      owner: process.env.GITHUB_OWNER || body?.settings?.owner || defaultOwner,
      repo: process.env.GITHUB_REPO || body?.settings?.repo || defaultRepo,
      branch: process.env.GITHUB_BRANCH || body?.settings?.branch || defaultBranch,
      basePath: cleanRepoPath(process.env.GITHUB_BASE_PATH || body?.settings?.basePath || defaultBasePath),
      token,
    };

    const files = Array.isArray(body?.files) ? body.files : [];
    const file = body?.file;
    const entry = body?.entry;
    const previewHtml = String(body?.previewHtml || '');
    const uploadPath = cleanRepoPath(body?.uploadPath || '');
    const commitPrefix = String(body?.commitPrefix || 'Add Spine preview');
    const action = String(body?.action || '');

    if (action === 'put-file') {
      if (!googlePayload && !anonymousAccount) throw unauthorized('Anonymous account is required');
      const path = cleanRepoPath(file?.path || body?.path || '');
      const contentBase64 = String(file?.contentBase64 || body?.contentBase64 || '');
      const message = String(body?.message || `${commitPrefix}: ${path.split('/').pop() || 'file'}`);
      if (!path || !contentBase64) return response.status(400).json({ error: 'Invalid file payload' });
      await putGitHubContent(settings, path, contentBase64, message, undefined, origin);
      return response.status(200).json({ ok: true, path });
    }

    if (action === 'update-index') {
      if (!googlePayload && !anonymousAccount) throw unauthorized('Anonymous account is required');
      if (!entry) return response.status(400).json({ error: 'Invalid index payload' });
      const indexPath = joinRepoPath(settings.basePath, 'index.json');
      const currentIndex = await getGitHubContent(settings, indexPath);
      const currentEntries = currentIndex?.content && currentIndex.encoding === 'base64' ? JSON.parse(base64ToText(currentIndex.content)) : [];
      const nextEntry = {
        ...entry,
        ...(googlePayload?.email ? { ownerEmail: googlePayload.email } : {}),
        ...(anonymousAccount?.id ? { ownerAnonId: anonymousAccount.id, ownerAnonFingerprint: anonymousAccount.fingerprint } : {}),
      };
      const nextEntries = [nextEntry, ...currentEntries.filter((currentEntry) => currentEntry.id !== nextEntry.id)];
      await putGitHubContent(settings, indexPath, textToBase64(JSON.stringify(nextEntries, null, 2)), `${commitPrefix}: update library index`, currentIndex?.sha, origin);
      return response.status(200).json({ ok: true, indexed: nextEntries.length });
    }


    if (action === 'update-note') {
      if (!googlePayload && !anonymousAccount) throw unauthorized('Anonymous account is required');
      const entryId = String(body?.entryId || '').trim();
      if (!entryId) return response.status(400).json({ error: 'Invalid note payload' });
      const indexPath = joinRepoPath(settings.basePath, 'index.json');
      const currentIndex = await getGitHubContent(settings, indexPath);
      const currentEntries = currentIndex?.content && currentIndex.encoding === 'base64' ? JSON.parse(base64ToText(currentIndex.content)) : [];
      const entryIndex = currentEntries.findIndex((currentEntry) => String(currentEntry?.id || '') === entryId);
      if (entryIndex < 0) return response.status(404).json({ error: 'Library entry not found' });
      if (!canEditEntry(currentEntries[entryIndex], googlePayload, anonymousAccount)) throw unauthorized('Only the owner can edit this text', 403);
      const note = normalizeNote(body?.note || '');
      const nextEntry = { ...currentEntries[entryIndex] };
      if (note) nextEntry.note = note;
      else delete nextEntry.note;
      const nextEntries = [...currentEntries];
      nextEntries[entryIndex] = nextEntry;
      await putGitHubContent(settings, indexPath, textToBase64(JSON.stringify(nextEntries, null, 2)), `${commitPrefix}: update preview text`, currentIndex?.sha, origin);
      return response.status(200).json({ ok: true, entry: nextEntry });
    }

    if (action === 'delete-entry') {
      if (!googlePayload && !anonymousAccount) throw unauthorized('Anonymous account is required');
      const entryId = String(body?.entryId || '').trim();
      if (!entryId) return response.status(400).json({ error: 'Invalid delete payload' });
      const indexPath = joinRepoPath(settings.basePath, 'index.json');
      const currentIndex = await getGitHubContent(settings, indexPath);
      const currentEntries = currentIndex?.content && currentIndex.encoding === 'base64' ? JSON.parse(base64ToText(currentIndex.content)) : [];
      const entry = currentEntries.find((currentEntry) => String(currentEntry?.id || '') === entryId);
      if (!entry) return response.status(404).json({ error: 'Library entry not found' });
      if (!canEditEntry(entry, googlePayload, anonymousAccount)) throw unauthorized('Only the owner can delete this entry', 403);
      const previewPath = cleanRepoPath(entry.previewPath || joinRepoPath(settings.basePath, entryId));
      if (previewPath) await deleteGitHubPath(settings, previewPath, commitPrefix);
      const nextEntries = currentEntries.filter((currentEntry) => String(currentEntry?.id || '') !== entryId);
      await putGitHubContent(settings, indexPath, textToBase64(JSON.stringify(nextEntries, null, 2)), `${commitPrefix}: update library index`, currentIndex?.sha, origin);
      return response.status(200).json({ ok: true, deleted: entryId });
    }

    if (action === 'get-index') {
      if (!googlePayload && !anonymousAccount) throw unauthorized('Anonymous account is required');
      const indexPath = joinRepoPath(settings.basePath, 'index.json');
      const currentIndex = await getGitHubContent(settings, indexPath);
      const currentEntries = currentIndex?.content && currentIndex.encoding === 'base64' ? JSON.parse(base64ToText(currentIndex.content)) : [];
      const userEmail = String(googlePayload?.email || '').toLowerCase();
      const anonymousId = String(anonymousAccount?.id || '').toLowerCase();
      const entries = currentEntries.filter((currentEntry) => {
        const ownerEmail = String(currentEntry?.ownerEmail || '').toLowerCase();
        const ownerAnonId = String(currentEntry?.ownerAnonId || '').toLowerCase();
        return (userEmail && ownerEmail === userEmail) || (anonymousId && ownerAnonId === anonymousId);
      });
      return response.status(200).json({ ok: true, entries });
    }

    if (action === 'merge-anonymous-account') {
      if (!googlePayload?.email) throw unauthorized('Sign in with Google before merging library');
      if (!anonymousAccount) throw unauthorized('Anonymous account is required');
      const indexPath = joinRepoPath(settings.basePath, 'index.json');
      const currentIndex = await getGitHubContent(settings, indexPath);
      const currentEntries = currentIndex?.content && currentIndex.encoding === 'base64' ? JSON.parse(base64ToText(currentIndex.content)) : [];
      const anonymousId = anonymousAccount.id.toLowerCase();
      const userEmail = String(googlePayload.email || '').toLowerCase();
      let changed = false;
      const nextEntries = currentEntries.map((currentEntry) => {
        const ownerAnonId = String(currentEntry?.ownerAnonId || '').toLowerCase();
        if (ownerAnonId !== anonymousId) return currentEntry;
        changed = changed || String(currentEntry?.ownerEmail || '').toLowerCase() !== userEmail;
        return { ...currentEntry, ownerEmail: googlePayload.email };
      });
      if (changed) {
        await putGitHubContent(settings, indexPath, textToBase64(JSON.stringify(nextEntries, null, 2)), `${commitPrefix}: merge library account`, currentIndex?.sha, origin);
      }
      const entries = nextEntries.filter((currentEntry) => {
        const ownerEmail = String(currentEntry?.ownerEmail || '').toLowerCase();
        const ownerAnonId = String(currentEntry?.ownerAnonId || '').toLowerCase();
        return ownerEmail === userEmail || ownerAnonId === anonymousId;
      });
      return response.status(200).json({ ok: true, entries, merged: changed });
    }

    if (!settings.owner || !settings.repo || !uploadPath || !entry || !previewHtml || files.length < 3) {
      return response.status(400).json({ error: 'Invalid upload payload' });
    }

    if (!googlePayload && !anonymousAccount) throw unauthorized('Anonymous account is required');

    for (const file of files) {
      await putGitHubContent(settings, joinRepoPath(uploadPath, file.name), file.contentBase64, `${commitPrefix}: ${file.name}`, undefined, origin);
    }

    await putGitHubContent(settings, joinRepoPath(uploadPath, 'preview.html'), textToBase64(previewHtml), `${commitPrefix}: preview.html`, undefined, origin);
    await putGitHubContent(settings, joinRepoPath(uploadPath, 'manifest.json'), textToBase64(JSON.stringify(entry, null, 2)), `${commitPrefix}: manifest.json`, undefined, origin);

    const indexPath = joinRepoPath(settings.basePath, 'index.json');
    const currentIndex = await getGitHubContent(settings, indexPath);
    const currentEntries = currentIndex?.content && currentIndex.encoding === 'base64' ? JSON.parse(base64ToText(currentIndex.content)) : [];
    const nextEntry = {
      ...entry,
      ...(googlePayload?.email ? { ownerEmail: googlePayload.email } : {}),
      ...(anonymousAccount?.id ? { ownerAnonId: anonymousAccount.id, ownerAnonFingerprint: anonymousAccount.fingerprint } : {}),
    };
    const nextEntries = [nextEntry, ...currentEntries.filter((currentEntry) => currentEntry.id !== nextEntry.id)];

    await putGitHubContent(settings, indexPath, textToBase64(JSON.stringify(nextEntries, null, 2)), `${commitPrefix}: update library index`, currentIndex?.sha, origin);

    return response.status(200).json({
      ok: true,
      repositoryUrl: entry.repositoryUrl,
      previewUrl: `/api/github-preview?path=${encodeURIComponent(entry.previewPath)}`,
      uploaded: files.length + 3,
    });
  } catch (error) {
    const statusCode = Number(error?.statusCode) || 500;
    return response.status(statusCode).json({ error: error instanceof Error ? error.message : 'Upload failed' });
  }
}
