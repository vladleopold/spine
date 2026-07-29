import { createHash } from 'crypto';
import { verifyGoogleToken } from './github-upload.js';

const defaultOwner = 'vladleopold';
const defaultRepo = 'spine';
const defaultBranch = 'main';
const defaultBasePath = 'library';

function getSettings(event) {
  const env = event.context?.cloudflare?.env || process.env || {};
  return {
    owner: env.GITHUB_OWNER || defaultOwner,
    repo: env.GITHUB_REPO || defaultRepo,
    branch: env.GITHUB_BRANCH || defaultBranch,
    basePath: env.GITHUB_BASE_PATH || defaultBasePath,
    token: env.GITHUB_TOKEN || '',
  };
}

const archiveAdminEmails = new Set([
  'vladyslavchaplygin@gmail.com',
  'vladyslavchaplyрin@gmail.com',
  'leopolds2010@gmail.com',
]);

function isArchiveAdmin(email) {
  return archiveAdminEmails.has(String(email || '').trim().toLowerCase());
}

function githubHeaders(token) {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

async function githubGet(settings, path) {
  const encodedPath = encodeURIComponent(path).replace(/%2F/g, '/');
  const url = `https://api.github.com/repos/${settings.owner}/${settings.repo}/contents/${encodedPath}?ref=${encodeURIComponent(settings.branch)}`;
  const response = await fetch(url, { headers: githubHeaders(settings.token) });
  if (!response.ok) return null;
  const data = await response.json();
  if (!data?.content) {
    if (data?.download_url) {
      const raw = await fetch(data.download_url);
      if (raw.ok) return await raw.text();
    }
    return null;
  }
  return Buffer.from(data.content.replace(/\s/g, ''), 'base64').toString('utf8');
}

async function githubPut(settings, path, content, message, token) {
  const encodedPath = encodeURIComponent(path).replace(/%2F/g, '/');
  const url = `https://api.github.com/repos/${settings.owner}/${settings.repo}/contents/${encodedPath}`;
  const sha = createHash('sha1').update(content).digest('hex');
  let existingSha = '';
  try {
    const existing = await fetch(url + `?ref=${encodeURIComponent(settings.branch)}`, {
      headers: githubHeaders(token || settings.token),
    });
    if (existing.ok) {
      const ed = await existing.json();
      existingSha = ed?.sha || '';
    }
  } catch {}

  const body = {
    message,
    content: Buffer.from(content, 'utf8').toString('base64'),
    branch: settings.branch,
  };
  if (existingSha) body.sha = existingSha;

  const response = await fetch(url, {
    method: 'PUT',
    headers: {
      ...githubHeaders(token || settings.token),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(body),
  });
  return response.ok;
}

async function dispatchWorkflow(settings, workflowFile, inputs = {}) {
  const url = `https://api.github.com/repos/${settings.owner}/${settings.repo}/dispatches`;
  const response = await fetch(url, {
    method: 'POST',
    headers: {
      ...githubHeaders(settings.token),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({
      event_type: 'admin-dispatch',
      client_payload: { workflow: workflowFile, ...inputs },
    }),
  });
  return response.ok;
}

export default async function handler(event) {
  if (event.method !== 'POST') {
    return new Response(JSON.stringify({ error: 'POST only' }), { status: 405, headers: { 'Content-Type': 'application/json' } });
  }

  let body;
  try { body = await event.request.json(); } catch { return new Response(JSON.stringify({ error: 'Invalid JSON' }), { status: 400, headers: { 'Content-Type': 'application/json' } }); }

  const { action, accessToken } = body;
  if (!action || !accessToken) {
    return new Response(JSON.stringify({ error: 'Missing action or accessToken' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
  }

  let googleUser;
  try {
    googleUser = await verifyGoogleToken(accessToken);
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid Google token' }), { status: 401, headers: { 'Content-Type': 'application/json' } });
  }

  if (!isArchiveAdmin(googleUser.email)) {
    return new Response(JSON.stringify({ error: 'Not an administrator' }), { status: 403, headers: { 'Content-Type': 'application/json' } });
  }

  const settings = getSettings(event);

  try {
    switch (action) {
      case 'get-settings': {
        const text = await githubGet(settings, `${settings.basePath}/site-settings.json`);
        const data = text ? JSON.parse(text) : {};
        return new Response(JSON.stringify({ ok: true, settings: data }), { headers: { 'Content-Type': 'application/json' } });
      }

      case 'save-settings': {
        const { settings: newSettings } = body;
        if (!newSettings || typeof newSettings !== 'object') {
          return new Response(JSON.stringify({ error: 'Invalid settings' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        }
        const ok = await githubPut(
          settings,
          `${settings.basePath}/site-settings.json`,
          JSON.stringify(newSettings, null, 2),
          `Admin: update site settings`,
          accessToken,
        );
        return new Response(JSON.stringify({ ok }), { headers: { 'Content-Type': 'application/json' } });
      }

      case 'get-index': {
        const text = await githubGet(settings, `${settings.basePath}/index.json`);
        const data = text ? JSON.parse(text) : [];
        const entries = Array.isArray(data) ? data.map(e => ({
          id: e.id,
          title: e.title,
          ownerEmail: e.ownerEmail,
          ownerName: e.ownerName,
          hiddenFromPublicLibrary: e.hiddenFromPublicLibrary,
          uploadedAt: e.uploadedAt,
          animations: Array.isArray(e.animations) ? e.animations.length : 0,
          pageMode: e.pageMode,
        })) : [];
        return new Response(JSON.stringify({ ok: true, entries, total: entries.length }), { headers: { 'Content-Type': 'application/json' } });
      }

      case 'get-users': {
        const text = await githubGet(settings, `${settings.basePath}/index.json`);
        const data = text ? JSON.parse(text) : [];
        const userMap = new Map();
        for (const e of (Array.isArray(data) ? data : [])) {
          const key = e.ownerEmail || e.ownerAnonId || 'unknown';
          if (!userMap.has(key)) {
            userMap.set(key, {
              email: e.ownerEmail || '',
              name: e.ownerName || '',
              anonId: e.ownerAnonId || '',
              entries: 0,
              totalViews: 0,
            });
          }
          const u = userMap.get(key);
          u.entries++;
        }
        const users = Array.from(userMap.values());
        return new Response(JSON.stringify({ ok: true, users, total: users.length }), { headers: { 'Content-Type': 'application/json' } });
      }

      case 'delete-entry': {
        const { entryId } = body;
        if (!entryId) return new Response(JSON.stringify({ error: 'Missing entryId' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        const text = await githubGet(settings, `${settings.basePath}/index.json`);
        const data = text ? JSON.parse(text) : [];
        const filtered = (Array.isArray(data) ? data : []).filter(e => e.id !== entryId);
        if (filtered.length === data.length) {
          return new Response(JSON.stringify({ error: 'Entry not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
        }
        const ok = await githubPut(
          settings,
          `${settings.basePath}/index.json`,
          JSON.stringify(filtered, null, 2),
          `Admin: delete entry ${entryId}`,
          accessToken,
        );
        return new Response(JSON.stringify({ ok, remaining: filtered.length }), { headers: { 'Content-Type': 'application/json' } });
      }

      case 'toggle-entry-visibility': {
        const { entryId } = body;
        if (!entryId) return new Response(JSON.stringify({ error: 'Missing entryId' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        const text = await githubGet(settings, `${settings.basePath}/index.json`);
        const data = text ? JSON.parse(text) : [];
        let found = false;
        const updated = (Array.isArray(data) ? data : []).map(e => {
          if (e.id === entryId) {
            found = true;
            return { ...e, hiddenFromPublicLibrary: !e.hiddenFromPublicLibrary };
          }
          return e;
        });
        if (!found) return new Response(JSON.stringify({ error: 'Entry not found' }), { status: 404, headers: { 'Content-Type': 'application/json' } });
        const ok = await githubPut(
          settings,
          `${settings.basePath}/index.json`,
          JSON.stringify(updated, null, 2),
          `Admin: toggle visibility for ${entryId}`,
          accessToken,
        );
        return new Response(JSON.stringify({ ok }), { headers: { 'Content-Type': 'application/json' } });
      }

      case 'trigger-workflow': {
        const { workflow, filter_id } = body;
        if (!workflow) return new Response(JSON.stringify({ error: 'Missing workflow' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        const allowedWorkflows = ['spine-export-all.yml', 'spine-export-webm.yml'];
        if (!allowedWorkflows.includes(workflow)) {
          return new Response(JSON.stringify({ error: 'Workflow not allowed' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        }
        const ok = await dispatchWorkflow(settings, workflow, { filter_id: filter_id || '' });
        return new Response(JSON.stringify({ ok }), { headers: { 'Content-Type': 'application/json' } });
      }

      case 'get-metrics': {
        const text = await githubGet(settings, `${settings.basePath}/metrics.json`);
        const data = text ? JSON.parse(text) : {};
        return new Response(JSON.stringify({ ok: true, metrics: data }), { headers: { 'Content-Type': 'application/json' } });
      }

      case 'get-exclusions': {
        const text = await githubGet(settings, `${settings.basePath}/archive-exclusions.json`);
        const data = text ? JSON.parse(text) : { rules: [] };
        return new Response(JSON.stringify({ ok: true, exclusions: data }), { headers: { 'Content-Type': 'application/json' } });
      }

      case 'save-exclusions': {
        const { exclusions } = body;
        if (!exclusions || typeof exclusions !== 'object') {
          return new Response(JSON.stringify({ error: 'Invalid exclusions' }), { status: 400, headers: { 'Content-Type': 'application/json' } });
        }
        const ok = await githubPut(
          settings,
          `${settings.basePath}/archive-exclusions.json`,
          JSON.stringify(exclusions, null, 2),
          `Admin: update archive exclusion rules`,
          accessToken,
        );
        return new Response(JSON.stringify({ ok }), { headers: { 'Content-Type': 'application/json' } });
      }

      case 'rebuild-cache': {
        return new Response(JSON.stringify({ ok: true, message: 'Cache will rebuild on next request' }), { headers: { 'Content-Type': 'application/json' } });
      }

      default:
        return new Response(JSON.stringify({ error: `Unknown action: ${action}` }), { status: 400, headers: { 'Content-Type': 'application/json' } });
    }
  } catch (err) {
    return new Response(JSON.stringify({ error: err?.message || 'Internal error' }), { status: 500, headers: { 'Content-Type': 'application/json' } });
  }
}
