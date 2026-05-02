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

function safeImage(value = '') {
  const url = String(value).trim();
  return /^https:\/\/[^\s"'<>]+$/i.test(url) || /^data:image\/(?:gif|png|jpe?g|webp);base64,/i.test(url) ? url : '';
}

function githubHeaders(token) {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

async function githubText(settings, path) {
  const encodedPath = encodeURIComponent(path).replace(/%2F/g, '/');
  const response = await fetch(`https://api.github.com/repos/${settings.owner}/${settings.repo}/contents/${encodedPath}?ref=${encodeURIComponent(settings.branch)}`, {
    headers: githubHeaders(settings.token),
  });
  if (!response.ok) return '';
  const data = await response.json();
  return data?.content ? base64ToText(data.content) : '';
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

function createLibraryHtml({ origin, publicOwnerId, entries }) {
  const firstEntry = entries[0] || {};
  const showOwnerName = firstEntry.showOwnerLibrary !== false;
  const ownerName = escapeHtml(showOwnerName ? firstEntry.ownerName || 'Spine-Link creator' : 'Spine-Link library');
  const ownerPicture = showOwnerName ? safeImage(firstEntry.ownerPicture || '') : '';
  const title = `${ownerName} - Spine-Link public library`;
  const cards = entries
    .map((entry) => {
      const itemTitle = escapeHtml(entry.title || entry.id || 'Spine preview');
      const previewUrl = `/p/${encodeURIComponent(String(entry.id || ''))}`;
      const thumbnail = safeImage(entry.thumbnail || '');
      const isGifPreview = entry.thumbnailType === 'gif' || /^data:image\/gif;base64,/i.test(thumbnail);
      const date = entry.uploadedAt ? new Date(entry.uploadedAt) : null;
      const dateText = date && !Number.isNaN(date.getTime()) ? date.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' }) : 'Saved';
      const animations = Array.isArray(entry.animations) ? entry.animations.length : 0;
      const entryId = escapeHtml(String(entry.id || ''));
      const image = thumbnail
        ? `<img src="${thumbnail}" alt="" />${isGifPreview ? '' : ''}`
        : `<div class="thumb-fallback" aria-hidden="true">${animations}</div>`;
      return `<article class="card" data-entry-id="${entryId}">
        <a class="card-link" href="${previewUrl}" aria-label="Open ${itemTitle}">
          <div class="thumb">${image}</div>
          <div class="card-body">
            <strong>${itemTitle}</strong>
            <span>${escapeHtml(entry.skeleton || 'Spine preview')}</span>
            <small>${animations} animations · ${escapeHtml(dateText)}</small>
          </div>
        </a>
        <div class="order-actions" aria-label="Change ${itemTitle} order">
          <button type="button" data-order="up" data-entry-id="${entryId}">Up</button>
          <button type="button" data-order="down" data-entry-id="${entryId}">Down</button>
        </div>
      </article>`;
    })
    .join('');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${escapeHtml(title)}</title>
    <meta name="robots" content="index,follow" />
    <link rel="canonical" href="${origin}/u/${encodeURIComponent(publicOwnerId)}" />
    <style>
      * { box-sizing: border-box; }
      body { min-height: 100vh; margin: 0; color: #edf5ff; background: #070809; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      .page { width: min(1180px, calc(100% - 32px)); margin: 0 auto; padding: 26px 0 42px; }
      .top { display: flex; justify-content: space-between; gap: 16px; align-items: center; margin-bottom: 28px; }
      .brand { color: #fff; text-decoration: none; font-size: 34px; font-weight: 900; letter-spacing: .08em; }
      .brand span { color: #ff6a28; }
      .profile { display: grid; grid-template-columns: 76px minmax(0, 1fr); gap: 18px; align-items: center; margin-bottom: 28px; padding: 18px; border: 1px solid rgba(255,255,255,.1); border-radius: 8px; background: rgba(255,255,255,.045); }
      .avatar { width: 76px; height: 76px; border-radius: 50%; object-fit: cover; background: #b3ff40; }
      .avatar-fallback { display: grid; place-items: center; color: #111; font-size: 30px; font-weight: 900; }
      h1 { margin: 0 0 7px; font-size: clamp(30px, 5vw, 58px); line-height: 1; letter-spacing: 0; }
      .profile p { margin: 0; color: rgba(237,245,255,.66); font-size: 15px; }
      .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(240px, 1fr)); gap: 14px; }
      .card { position: relative; display: block; overflow: hidden; min-height: 320px; border: 1px solid rgba(140,199,255,.2); border-radius: 8px; color: inherit; background: #060708; transition: transform 150ms ease, border-color 150ms ease; }
      .card:hover { transform: translateY(-3px); border-color: rgba(179,255,64,.68); }
      .card-link { position: absolute; inset: 0; color: inherit; text-decoration: none; }
      .thumb { position: absolute; inset: 0; display: grid; place-items: center; min-height: 100%; background: linear-gradient(135deg, rgba(255,106,40,.18), rgba(140,199,255,.16)); }
      .thumb img { width: 100%; height: 100%; object-fit: cover; }
      .thumb-fallback { color: #fff; font-size: 56px; font-weight: 900; }
      .card-body { position: absolute; right: 0; bottom: 48px; left: 0; z-index: 1; display: grid; gap: 7px; padding: 15px; background: rgba(32,35,38,.5); backdrop-filter: blur(10px); }
      .card-body strong, .card-body span, .card-body small { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .card-body span, .card-body small { color: rgba(237,245,255,.64); }
      .order-actions { position: absolute; right: 12px; bottom: 12px; left: 12px; z-index: 3; display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
      .order-actions button { min-height: 34px; border: 1px solid rgba(179,255,64,.42); border-radius: 7px; color: #f4ffe8; background: rgba(11,16,18,.72); font: inherit; font-size: 12px; font-weight: 900; cursor: pointer; backdrop-filter: blur(8px); }
      .order-actions button:hover { border-color: rgba(179,255,64,.8); background: rgba(179,255,64,.16); }
      .order-actions button:disabled { cursor: default; opacity: .5; }
      .empty { padding: 34px; border: 1px dashed rgba(255,255,255,.16); border-radius: 8px; color: rgba(237,245,255,.68); text-align: center; }
      @media (max-width: 640px) { .profile { grid-template-columns: 1fr; } .top { align-items: flex-start; flex-direction: column; } }
    </style>
  </head>
  <body>
    <main class="page">
      <div class="top"><a class="brand" href="/">spine<span>link</span></a></div>
      <section class="profile">
        ${ownerPicture ? `<img class="avatar" src="${ownerPicture}" alt="" />` : `<div class="avatar avatar-fallback" aria-hidden="true">${ownerName.slice(0, 1).toUpperCase()}</div>`}
        <div>
          <h1>${ownerName}</h1>
          <p>${entries.length} public Spine previews</p>
        </div>
      </section>
      ${entries.length ? `<section class="grid">${cards}</section>` : '<div class="empty">This public library is empty or hidden.</div>'}
    </main>
    <script>
      const anonymousAccountStorageKey = "spine-link-anonymous-account";
      function readAnonymousAccount() {
        try { return JSON.parse(window.localStorage.getItem(anonymousAccountStorageKey) || "null"); }
        catch { return null; }
      }
      async function moveLibraryEntry(entryId, direction, button) {
        const anonymousAccount = readAnonymousAccount();
        if (!anonymousAccount?.id) return;
        button.disabled = true;
        try {
          const response = await fetch("/api/github-upload", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              action: "update-library-order",
              anonymousAccount,
              entryId,
              direction,
              commitPrefix: "Reorder Spine-Link public library"
            })
          });
          if (!response.ok) throw new Error("Order was not saved");
          window.location.reload();
        } catch {
          button.disabled = false;
        }
      }
      document.querySelectorAll("[data-order]").forEach((button) => {
        button.addEventListener("click", (event) => {
          event.preventDefault();
          event.stopPropagation();
          moveLibraryEntry(button.dataset.entryId || "", button.dataset.order || "", button);
        });
      });
    </script>
  </body>
</html>`;
}

export default async function handler(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return response.status(405).send('Method not allowed');
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) return response.status(500).send('GITHUB_TOKEN is not configured');

  const publicOwnerId = String(request.query?.user || '').trim();
  if (!/^u_[a-z0-9]{3,32}$/i.test(publicOwnerId)) return response.status(400).send('Invalid public library');

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
    const allEntries = indexText ? JSON.parse(indexText) : [];
    const entries = Array.isArray(allEntries)
      ? allEntries.filter((entry) => String(entry?.publicOwnerId || '') === publicOwnerId && entry?.hiddenFromPublicLibrary !== true)
      : [];
    entries.sort(compareLibraryEntries);

    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
    return response.status(entries.length ? 200 : 404).send(createLibraryHtml({ origin, publicOwnerId, entries }));
  } catch (error) {
    return response.status(500).send(error instanceof Error ? error.message : 'Library failed');
  }
}
