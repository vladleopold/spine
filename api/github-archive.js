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

function safeVideo(value = '') {
  const url = String(value).trim();
  return /^https:\/\/[^\s"'<>]+$/i.test(url) || /^data:video\/webm;base64,/i.test(url) ? url : '';
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

function compareArchiveEntries(a, b) {
  return String(b?.uploadedAt || '').localeCompare(String(a?.uploadedAt || ''));
}

function previewUrl(entry) {
  const id = encodeURIComponent(String(entry?.id || ''));
  const animation = String(entry?.defaultAnimation || '').trim();
  return animation ? `/p/${id}?animation=${encodeURIComponent(animation)}` : `/p/${id}`;
}

function mediaHtml(entry, { posterClass = '' } = {}) {
  const video = safeVideo(entry?.webmPreview || '');
  const thumbnail = safeImage(entry?.thumbnail || '');
  const poster = safeImage(entry?.thumbnailPoster || '');
  if (video) {
    return `<video class="${posterClass}" src="${escapeHtml(video)}" ${poster ? `poster="${escapeHtml(poster)}"` : ''} autoplay muted loop playsinline preload="metadata"></video>`;
  }
  if (thumbnail) {
    return `<img class="${posterClass}" src="${escapeHtml(thumbnail)}" alt="" loading="lazy" decoding="async" />`;
  }
  return `<div class="media-fallback">${Array.isArray(entry?.animations) ? entry.animations.length : 0}</div>`;
}

function baseStyles() {
  return `
      * { box-sizing: border-box; }
      * { scrollbar-width: thin; scrollbar-color: rgba(74,78,84,.72) transparent; }
      *::-webkit-scrollbar { width: 8px; height: 8px; }
      *::-webkit-scrollbar-track { background: transparent; }
      *::-webkit-scrollbar-thumb { border: 2px solid transparent; border-radius: 999px; background: rgba(74,78,84,.72); background-clip: content-box; }
      html, body { min-height: 100%; margin: 0; }
      body { color: #edf5ff; background: #050607; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      .page { width: min(1440px, calc(100% - 28px)); margin: 0 auto; padding: 26px 0 46px; }
      .top { display: flex; align-items: end; justify-content: space-between; gap: 18px; margin-bottom: 22px; }
      .brand { color: #fff; text-decoration: none; font-size: clamp(32px, 5vw, 72px); font-weight: 950; letter-spacing: .02em; line-height: .9; }
      .brand span { display: block; color: #ff6a28; font-size: 12px; letter-spacing: .32em; text-transform: uppercase; }
      .back { color: #b3ff40; font-weight: 800; text-decoration: none; }
      .muted { color: rgba(237,245,255,.62); }
      @media (max-width: 700px) {
        * { scrollbar-width: none; }
        *::-webkit-scrollbar { width: 0; height: 0; display: none; }
        .page { width: min(100% - 18px, 1440px); padding-top: 18px; }
        .top { align-items: flex-start; flex-direction: column; }
      }
  `;
}

function archiveHtml({ origin, entries }) {
  const cards = entries
    .map((entry) => {
      const title = escapeHtml(entry?.title || entry?.id || 'Spine preview');
      const animations = Array.isArray(entry?.animations) ? entry.animations.length : 0;
      const id = encodeURIComponent(String(entry?.id || ''));
      return `<a class="tile" href="/world-spine-archive/${id}" aria-label="Open ${title}">
        <div class="tile-media">${mediaHtml(entry)}</div>
        <div class="tile-info"><strong>${title}</strong><span>${animations} animations</span></div>
      </a>`;
    })
    .join('');

  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>World Spine Archive</title>
    <meta name="robots" content="index,follow" />
    <link rel="canonical" href="${origin}/world-spine-archive" />
    <style>
      ${baseStyles()}
      .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(180px, 1fr)); grid-auto-flow: dense; gap: 10px; }
      .tile { position: relative; min-height: 220px; overflow: hidden; border: 1px solid rgba(140,199,255,.18); border-radius: 8px; color: inherit; background: #090b0d; text-decoration: none; }
      .tile:nth-child(5n + 1) { grid-row: span 2; min-height: 450px; }
      .tile:nth-child(7n + 3) { grid-column: span 2; }
      .tile:hover { border-color: rgba(179,255,64,.68); }
      .tile-media, .tile-media img, .tile-media video { position: absolute; inset: 0; width: 100%; height: 100%; }
      .tile-media img, .tile-media video { object-fit: cover; transform: scale(1.08); background: #050607; }
      .tile-info { position: absolute; right: 0; bottom: 0; left: 0; display: grid; gap: 4px; padding: 12px; background: rgba(16,19,22,.54); backdrop-filter: blur(12px); }
      .tile-info strong, .tile-info span { overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
      .tile-info span { color: rgba(237,245,255,.62); font-size: 12px; }
      .media-fallback { display: grid; place-items: center; width: 100%; height: 100%; color: #fff; font-size: 60px; font-weight: 950; background: radial-gradient(circle, rgba(140,199,255,.15), rgba(0,0,0,.92)); }
      @media (max-width: 700px) {
        .grid { grid-template-columns: repeat(2, minmax(0, 1fr)); gap: 8px; }
        .tile, .tile:nth-child(5n + 1) { min-height: 230px; grid-row: span 1; }
        .tile:nth-child(7n + 3) { grid-column: span 1; }
      }
    </style>
  </head>
  <body>
    <main class="page">
      <header class="top">
        <h1 class="brand"><span>Spine-Link</span>WORLD SPINE ARCHIVE</h1>
        <a class="back" href="/">Create preview</a>
      </header>
      ${entries.length ? `<section class="grid">${cards}</section>` : '<p class="muted">No public previews yet.</p>'}
    </main>
  </body>
</html>`;
}

function archiveItemHtml({ origin, entry }) {
  const title = escapeHtml(entry?.title || entry?.id || 'Spine preview');
  const animations = Array.isArray(entry?.animations) ? entry.animations.length : 0;
  const spineUrl = previewUrl(entry);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${title} - World Spine Archive</title>
    <meta name="robots" content="index,follow" />
    <link rel="canonical" href="${origin}/world-spine-archive/${encodeURIComponent(String(entry?.id || ''))}" />
    <style>
      ${baseStyles()}
      .viewer { display: grid; grid-template-columns: minmax(0, 1fr) 320px; gap: 18px; align-items: stretch; }
      .media-panel { min-height: min(74vh, 760px); overflow: hidden; border: 1px solid rgba(140,199,255,.2); border-radius: 8px; background: #050607; }
      .media-panel img, .media-panel video { width: 100%; height: 100%; min-height: min(74vh, 760px); object-fit: contain; background: #050607; }
      .side { display: flex; flex-direction: column; justify-content: space-between; gap: 18px; padding: 18px; border: 1px solid rgba(255,255,255,.1); border-radius: 8px; background: rgba(255,255,255,.045); }
      h1 { margin: 0 0 8px; font-size: clamp(30px, 5vw, 56px); line-height: .95; }
      .spine-link { display: inline-flex; justify-content: center; align-items: center; min-height: 48px; padding: 0 16px; border: 1px solid rgba(179,255,64,.72); border-radius: 8px; color: #eaffc2; font-weight: 900; text-decoration: none; background: rgba(179,255,64,.12); }
      @media (max-width: 860px) { .viewer { grid-template-columns: 1fr; } .media-panel, .media-panel img, .media-panel video { min-height: 58vh; } }
    </style>
  </head>
  <body>
    <main class="page">
      <header class="top">
        <a class="back" href="/world-spine-archive">WORLD SPINE ARCHIVE</a>
        <a class="back" href="/">Create preview</a>
      </header>
      <section class="viewer">
        <div class="media-panel">${mediaHtml(entry, { posterClass: 'media-main' })}</div>
        <aside class="side">
          <div>
            <p class="muted">Spine media preview</p>
            <h1>${title}</h1>
            <p class="muted">${animations} animations</p>
          </div>
          <a class="spine-link" href="${spineUrl}">Open Spine animation</a>
        </aside>
      </section>
    </main>
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
      ? allEntries.filter((entry) => entry?.hiddenFromPublicLibrary !== true && (entry?.webmPreview || entry?.thumbnail || entry?.thumbnailPoster))
      : [];
    entries.sort(compareArchiveEntries);

    const archiveId = String(request.query?.id || '').trim();
    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.setHeader('Cache-Control', 'public, max-age=0, must-revalidate');
    if (archiveId) {
      const entry = entries.find((item) => String(item?.id || '') === archiveId);
      return response.status(entry ? 200 : 404).send(entry ? archiveItemHtml({ origin, entry }) : 'Archive item not found');
    }

    return response.status(200).send(archiveHtml({ origin, entries }));
  } catch (error) {
    return response.status(500).send(error instanceof Error ? error.message : 'Archive failed');
  }
}
