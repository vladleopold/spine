const defaultOwner = 'vladleopold';
const defaultRepo = 'spine';
const defaultBranch = 'main';

function cleanRepoPath(value = '') {
  return String(value).trim().replace(/^\/+|\/+$/g, '').replace(/\/+/g, '/');
}

function joinRepoPath(...parts) {
  return parts.map(cleanRepoPath).filter(Boolean).join('/');
}

function encodeRepoPath(path) {
  return cleanRepoPath(path)
    .split('/')
    .filter(Boolean)
    .map((part) => encodeURIComponent(part))
    .join('/');
}

function versionedAssetUrl(origin, item, version) {
  const url = `${origin}/assets/${encodeRepoPath(item.path)}`;
  return version ? `${url}?v=${encodeURIComponent(version)}` : url;
}

function base64ToText(base64) {
  return Buffer.from(String(base64).replace(/\s/g, ''), 'base64').toString('utf8');
}

function escapedJson(value) {
  return JSON.stringify(value).replace(/</g, '\\u003c').replace(/\u2028/g, '\\u2028').replace(/\u2029/g, '\\u2029');
}

function githubHeaders(token) {
  return {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'X-GitHub-Api-Version': '2022-11-28',
  };
}

function isSkeleton(name) {
  const lower = name.toLowerCase();
  return lower.endsWith('.json') || lower.endsWith('.skel');
}

function isAtlas(name) {
  const lower = name.toLowerCase();
  return lower.endsWith('.atlas') || lower.endsWith('.atlas.txt') || lower.endsWith('.atlas.docx');
}

function isImage(name) {
  return /\.(png|jpe?g|webp)$/i.test(name);
}

function stem(name) {
  return name
    .replace(/\.atlas(?:\.txt|\.docx)?$/i, '')
    .replace(/\.(json|skel|png|jpe?g|webp)$/i, '');
}

function viewportFromJson(json) {
  const bounds = json?.skeleton;
  if (
    typeof bounds?.x === 'number' &&
    typeof bounds.y === 'number' &&
    typeof bounds.width === 'number' &&
    typeof bounds.height === 'number'
  ) {
    return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
  }
  return undefined;
}

function animationNamesFromJson(json) {
  return Object.keys(json?.animations || {});
}

function hasPremultipliedAlpha(atlasText = '') {
  const match = String(atlasText).match(/^\s*pma\s*:\s*(true|false)\s*$/im);
  return match ? match[1].toLowerCase() === 'true' : false;
}

async function githubJson(settings, path) {
  const encodedPath = encodeURIComponent(path).replace(/%2F/g, '/');
  const response = await fetch(`https://api.github.com/repos/${settings.owner}/${settings.repo}/contents/${encodedPath}?ref=${encodeURIComponent(settings.branch)}`, {
    headers: githubHeaders(settings.token),
  });
  if (!response.ok) return null;
  return response.json();
}

async function githubText(settings, path) {
  const data = await githubJson(settings, path);
  if (!data?.content) return '';
  return base64ToText(data.content);
}

async function githubList(settings, path) {
  const data = await githubJson(settings, path);
  return Array.isArray(data) ? data : [];
}

function createHtml(config) {
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Spine-Link</title>
    <link rel="icon" href="data:," />
    <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@esotericsoftware/spine-player@4.2.113/dist/spine-player.css" />
    <style>
      * { box-sizing: border-box; }
      html, body, #app { width: 100%; height: 100%; margin: 0; }
      body { overflow: hidden; background: #000; color: #e7edf4; font-family: Inter, ui-sans-serif, system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif; }
      #app { display: grid; grid-template-rows: auto minmax(0, 1fr); gap: 18px; padding: 24px; background: #000; }
      .topbar { display: flex; justify-content: space-between; gap: 18px; align-items: center; }
      .brand-link { display: inline-block; color: inherit; text-decoration: none; }
      .brand-logo { display: inline-flex; align-items: center; gap: 8px; color: #fff; font-family: "Trebuchet MS", Inter, ui-sans-serif, system-ui, sans-serif; font-size: clamp(34px, 4.4vw, 58px); font-weight: 500; line-height: .78; letter-spacing: .18em; text-shadow: 0 0 1px rgba(255,255,255,.86), 0 6px 18px rgba(0,0,0,.42); }
      .brand-spine-mark { display: inline-grid; gap: 4px; width: 16px; margin: 0 -3px 0 -5px; transform: translateY(1px); }
      .brand-spine-mark i { display: block; width: 16px; height: 7px; border-radius: 999px; background: #ff5a1f; box-shadow: 0 0 8px rgba(255,90,31,.22); }
      .brand-spine-mark i:nth-child(1) { transform: translateX(-1px); }
      .brand-spine-mark i:nth-child(2) { width: 14px; transform: translateX(2px); }
      .brand-spine-mark i:nth-child(3) { width: 12px; transform: translateX(4px); }
      .brand-spine-mark i:nth-child(4) { width: 10px; transform: translateX(6px); }
      .brand-spine-mark i:nth-child(5) { width: 8px; transform: translateX(8px); }
      .brand-plus { margin-left: 8px; color: #ff6a28; font-size: .72em; font-weight: 800; letter-spacing: .22em; line-height: 1; text-transform: uppercase; transform: translate(-15px, .18em); }
      .brand-link:hover .brand-plus { color: #8cc7ff; }
      .stage { min-height: 0; display: grid; grid-template-columns: minmax(0, 1fr) 400px; gap: 18px; }
      #player { min-height: 0; touch-action: none; border: 1px solid rgba(255,255,255,.1); border-radius: 8px; overflow: hidden; background: conic-gradient(#565656 25%, #505052 0 50%, #565656 0 75%, #505052 0); background-size: var(--preview-pattern-size, 140px) var(--preview-pattern-size, 140px); }
      #sidebar { min-height: 0; overflow: auto; display: flex; flex-direction: column; gap: 14px; padding-right: 2px; }
      .preview-card { padding: 16px; border: 1px solid rgba(255,255,255,.08); border-radius: 8px; background: rgba(255,255,255,.05); box-shadow: 0 18px 40px rgba(0,0,0,.18); }
      .section-title { margin: 0 0 10px; color: #f7fbff; font-size: 13px; font-weight: 900; letter-spacing: .08em; text-transform: uppercase; }
      select, button { width: 100%; }
      select { min-height: 48px; padding: 0 12px; border: 1px solid rgba(255,255,255,.12); border-radius: 8px; color: #e7edf4; background: #1a2027; }
      button { min-height: 38px; border: 1px solid rgba(255,255,255,.1); border-radius: 8px; color: rgba(231,237,244,.86); background: rgba(255,255,255,.045); cursor: pointer; }
      button.active, button:hover { border-color: rgba(140,199,255,.82); color: #fff; background: rgba(71,156,255,.22); }
      #animation-list { display: grid; grid-template-columns: repeat(auto-fit, minmax(112px, 1fr)); gap: 8px; }
      .note-text { margin: 0; color: rgba(231,237,244,.88); font-size: 16px; line-height: 1.45; overflow-wrap: anywhere; white-space: pre-wrap; }
      .note-card:empty { display: none; }
      @media (max-width: 760px) { body { overflow: auto; } #app { height: auto; min-height: 100%; padding: 16px; } .stage { grid-template-columns: 1fr; } #player { height: 60vh; min-height: 360px; } .topbar { align-items: flex-start; flex-direction: column; } }
      .spine-link-loop-button { position: relative; margin-right: 12px !important; }
      .spine-player-controls { z-index: 4; }
      .spine-player-controls.spine-player-controls-hidden { pointer-events: auto; opacity: 1; }
      .spine-link-loop-button::before, .spine-link-loop-button::after { position: absolute; inset: 0; display: grid; place-items: center; font-size: 30px; font-weight: 900; line-height: 1; }
      .spine-link-loop-button.is-on::before { content: "↻"; color: #54cfff; text-shadow: 0 0 14px rgba(84, 207, 255, 0.72); transform: translateY(-1px); }
      .spine-link-loop-button.is-off::before { content: "↻"; color: rgba(210, 216, 222, 0.42); transform: translateY(-1px); }
      .spine-link-loop-button.is-off::after { content: none; }
    </style>
  </head>
  <body>
    <div id="app">
      <header class="topbar">
        <a class="brand-link" href="/" aria-label="Spine-Link home"><span class="brand-logo" aria-hidden="true"><span>s</span><span>p</span><span class="brand-spine-mark"><i></i><i></i><i></i><i></i><i></i></span><span>n</span><span>e</span><span class="brand-plus">link</span></span></a>
      </header>
      <div class="stage">
        <div id="player"></div>
        <aside id="sidebar">
          <div class="preview-card" id="set-card"><div class="section-title">Set</div><select id="set-select"></select></div>
          <div class="preview-card note-card" id="note-card"><div class="section-title">Text</div><p class="note-text" id="note-text"></p></div>
          <div class="preview-card animation-card"><div class="section-title">Animations</div><div id="animation-list"></div></div>
        </aside>
      </div>
    </div>
    <script src="https://cdn.jsdelivr.net/npm/@esotericsoftware/spine-player@4.2.113/dist/iife/spine-player.js"></script>
    <script type="application/json" id="spine-preview-config">${escapedJson(config)}</script>
    <script>
      if (window.spine?.GLTexture) {
        window.spine.GLTexture.DISABLE_UNPACK_PREMULTIPLIED_ALPHA_WEBGL = true;
      }
      const config = JSON.parse(document.getElementById("spine-preview-config").textContent);
      const sets = config.sets || [];
      function queryValue(name) { return new URLSearchParams(window.location.search).get(name) || ""; }
      function setHasAnimation(set, animationName) { return Boolean(set && animationName && (set.animations || []).includes(animationName)); }
      function initialSet() {
        const querySet = queryValue("set");
        const queryAnimation = queryValue("animation");
        return sets.find((set) => set.label === querySet) || sets.find((set) => setHasAnimation(set, queryAnimation)) || sets.find((set) => set.label === config.activeLabel) || sets[0];
      }
      function initialAnimation(set) {
        const queryAnimation = queryValue("animation");
        return setHasAnimation(set, queryAnimation) ? queryAnimation : set?.animation || "";
      }
      const activeSet = { value: initialSet() };
      const activeAnimation = { name: initialAnimation(activeSet.value) };
      const loopEnabled = { value: true };
      const currentZoom = { value: config.zoom || 1 };
      const baseViewport = { value: null };
      const animationNames = { value: activeSet.value?.animations || [] };
      const animationList = document.getElementById("animation-list");
      const setCard = document.getElementById("set-card");
      const setSelect = document.getElementById("set-select");
      const noteCard = document.getElementById("note-card");
      const noteText = document.getElementById("note-text");
      const playerElement = document.getElementById("player");
      const pinchDistance = { value: null };
      const panPosition = { value: null };
      let player;
      function syncUrl(replace = false) {
        if (!activeSet.value || !activeAnimation.name) return;
        const url = new URL(window.location.href);
        if (sets.length > 1) url.searchParams.set("set", activeSet.value.label);
        else url.searchParams.delete("set");
        url.searchParams.set("animation", activeAnimation.name);
        const nextUrl = url.pathname + url.search + url.hash;
        if (nextUrl === window.location.pathname + window.location.search + window.location.hash) return;
        window.history[replace ? "replaceState" : "pushState"]({}, "", nextUrl);
      }
      function applySelectionFromUrl() {
        const nextSet = initialSet();
        activeSet.value = nextSet;
        activeAnimation.name = initialAnimation(nextSet);
        syncSetInfo();
        renderAnimationList();
        createPlayer();
      }
      function syncSetInfo() {
        if (!activeSet.value) return;
        animationNames.value = activeSet.value.animations || [];
        setCard.style.display = sets.length > 1 ? "" : "none";
        setSelect.value = activeSet.value.label;
        const note = String(config.note || "").trim();
        noteText.textContent = note;
        noteCard.style.display = note ? "" : "none";
      }
      function renderSetList() { setSelect.innerHTML = ""; sets.forEach((set) => { const option = document.createElement("option"); option.value = set.label; option.textContent = set.label; setSelect.appendChild(option); }); }
      function rememberBaseViewport() { if (!player?.currentViewport) return; const v = player.currentViewport; baseViewport.value = { x: v.x, y: v.y, width: v.width * currentZoom.value, height: v.height * currentZoom.value, padLeft: v.padLeft * currentZoom.value, padRight: v.padRight * currentZoom.value, padTop: v.padTop * currentZoom.value, padBottom: v.padBottom * currentZoom.value }; }
      function touchDistance(touches) { const a = touches.item(0), b = touches.item(1); if (!a || !b) return 0; return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY); }
      function applyZoom(nextZoom) { currentZoom.value = Math.min(4, Math.max(0.25, Number(nextZoom))); playerElement.style.setProperty("--preview-pattern-size", (140 * currentZoom.value) + "px"); const b = baseViewport.value; if (!b || !player?.currentViewport) return; const cx = b.x + b.width / 2, cy = b.y + b.height / 2, width = b.width / currentZoom.value, height = b.height / currentZoom.value; const next = { x: cx - width / 2, y: cy - height / 2, width, height, padLeft: b.padLeft / currentZoom.value, padRight: b.padRight / currentZoom.value, padTop: b.padTop / currentZoom.value, padBottom: b.padBottom / currentZoom.value }; player.previousViewport = { ...next }; player.currentViewport = next; player.viewportTransitionStart = performance.now(); }
      function updateLoopButtonState(button) { button.classList.toggle("is-on", loopEnabled.value); button.classList.toggle("is-off", !loopEnabled.value); button.title = loopEnabled.value ? "Loop on" : "Loop off"; button.setAttribute("aria-label", button.title); button.setAttribute("aria-pressed", String(loopEnabled.value)); }
      function setTrackLoop() { const entry = player?.animationState?.getCurrent?.(0); if (entry) entry.loop = loopEnabled.value; }
      function disableMix() { if (player?.animationState?.data) player.animationState.data.defaultMix = 0; }
      function playActiveAnimationFromStart() { if (!player || !activeAnimation.name) return; disableMix(); const entry = player.setAnimation(activeAnimation.name, loopEnabled.value); entry.mixDuration = 0; entry.mixTime = 0; entry.listener = { ...(entry.listener || {}), complete: () => { if (!loopEnabled.value) player.pause(); } }; player.play(); }
      function togglePlayback() { if (!player) return; if (player.paused === false) { player.pause(); return; } playActiveAnimationFromStart(); }
      function installLoopButton() { const buttons = player?.dom?.querySelector(".spine-player-buttons"); const playButton = buttons?.querySelector(".spine-player-button"); if (!buttons || !playButton) return; playButton.onclick = (event) => { event.preventDefault(); event.stopPropagation(); togglePlayback(); }; if (buttons.querySelector(".spine-link-loop-button")) return; const button = document.createElement("button"); button.type = "button"; button.className = "spine-player-button spine-link-loop-button"; updateLoopButtonState(button); button.onclick = (event) => { event.preventDefault(); event.stopPropagation(); loopEnabled.value = !loopEnabled.value; setTrackLoop(); updateLoopButtonState(button); }; playButton.insertAdjacentElement("afterend", button); }
      function panByPixels(deltaX, deltaY) { const v = player?.currentViewport, b = baseViewport.value, canvas = player?.canvas; if (!v || !b || !canvas) return; const totalWidth = v.width + v.padLeft + v.padRight, totalHeight = v.height + v.padTop + v.padBottom; const worldDeltaX = deltaX / Math.max(1, canvas.clientWidth) * totalWidth, worldDeltaY = deltaY / Math.max(1, canvas.clientHeight) * totalHeight; v.x -= worldDeltaX; v.y += worldDeltaY; b.x -= worldDeltaX * currentZoom.value; b.y += worldDeltaY * currentZoom.value; player.previousViewport = { ...v }; player.viewportTransitionStart = performance.now(); }
      function createPlayer() { if (!activeSet.value) return; player?.dispose(); document.getElementById("player").innerHTML = ""; baseViewport.value = null; player = new spine.SpinePlayer("player", { ...activeSet.value, showControls: true, showLoading: true, alpha: true, preserveDrawingBuffer: true, backgroundColor: "00000000", success: (loadedPlayer) => { player = loadedPlayer; disableMix(); installLoopButton(); playActiveAnimationFromStart(); requestAnimationFrame(() => { rememberBaseViewport(); applyZoom(currentZoom.value); }); } }); }
      function renderAnimationList() { animationList.innerHTML = ""; animationNames.value.forEach((animationName) => { const button = document.createElement("button"); button.type = "button"; button.textContent = animationName; button.className = animationName === activeAnimation.name ? "active" : ""; button.onclick = () => { activeAnimation.name = animationName; syncUrl(); playActiveAnimationFromStart(); applyZoom(currentZoom.value); renderAnimationList(); }; animationList.appendChild(button); }); }
      playerElement.addEventListener("wheel", (event) => { event.preventDefault(); applyZoom(currentZoom.value + (event.deltaY > 0 ? -0.1 : 0.1)); }, { passive: false });
      playerElement.addEventListener("touchstart", (event) => { if (event.touches.length === 2) pinchDistance.value = touchDistance(event.touches); }, { passive: false });
      playerElement.addEventListener("touchmove", (event) => { if (event.touches.length !== 2 || pinchDistance.value === null) return; event.preventDefault(); const nextDistance = touchDistance(event.touches); applyZoom(currentZoom.value + (nextDistance - pinchDistance.value) / 220); pinchDistance.value = nextDistance; }, { passive: false });
      playerElement.addEventListener("touchend", () => { pinchDistance.value = null; });
      playerElement.addEventListener("touchcancel", () => { pinchDistance.value = null; });
      playerElement.addEventListener("click", (event) => { if (event.target.closest(".spine-player-controls")) return; event.preventDefault(); event.stopImmediatePropagation(); if (event.button === 0) togglePlayback(); }, true);
      playerElement.addEventListener("dblclick", (event) => { if (event.target.closest(".spine-player-controls")) return; event.preventDefault(); event.stopImmediatePropagation(); }, true);
      playerElement.addEventListener("contextmenu", (event) => { event.preventDefault(); event.stopImmediatePropagation(); }, true);
      playerElement.addEventListener("mousedown", (event) => { if (event.button !== 2) return; event.preventDefault(); event.stopImmediatePropagation(); panPosition.value = { x: event.clientX, y: event.clientY }; }, true);
      window.addEventListener("mousemove", (event) => { if (!panPosition.value) return; event.preventDefault(); event.stopImmediatePropagation(); const deltaX = event.clientX - panPosition.value.x, deltaY = event.clientY - panPosition.value.y; panPosition.value = { x: event.clientX, y: event.clientY }; panByPixels(deltaX, deltaY); }, { passive: false, capture: true });
      window.addEventListener("mouseup", (event) => { if (event.button !== 2) return; event.preventDefault(); event.stopImmediatePropagation(); panPosition.value = null; }, true);
      setSelect.onchange = () => { activeSet.value = sets.find((set) => set.label === setSelect.value) || sets[0]; activeAnimation.name = activeSet.value?.animation || ""; syncSetInfo(); renderAnimationList(); syncUrl(); createPlayer(); };
      window.addEventListener("popstate", applySelectionFromUrl);
      renderSetList(); syncSetInfo(); syncUrl(true); createPlayer(); renderAnimationList();
    </script>
  </body>
</html>`;
}

async function createDynamicPreview(settings, uploadPath, origin) {
  const rootItems = await githubList(settings, uploadPath);
  const directories = rootItems.filter((item) => item.type === 'dir');
  const setDirectories = directories.length ? directories : [{ name: uploadPath.split('/').pop(), path: uploadPath }];
  const sets = [];
  let note = '';

  for (const directory of setDirectories) {
    const items = await githubList(settings, directory.path);
    const skeleton = items.find((item) => item.type === 'file' && isSkeleton(item.name));
    const atlas = items.find((item) => item.type === 'file' && isAtlas(item.name));
    const textures = items.filter((item) => item.type === 'file' && isImage(item.name));
    if (!skeleton || !atlas || textures.length === 0) continue;

    let skeletonJson = null;
    const atlasText = await githubText(settings, atlas.path);
    if (skeleton.name.toLowerCase().endsWith('.json')) {
      try {
        skeletonJson = JSON.parse(await githubText(settings, skeleton.path));
      } catch {
        skeletonJson = null;
      }
    }

    const animations = animationNamesFromJson(skeletonJson);
    const defaultAnimation =
      animations.find((name) => name.toLowerCase() === 'idle') ??
      animations.find((name) => name.toLowerCase().includes('idle')) ??
      animations[0] ??
      '';

    const assetVersion = [skeleton.sha, atlas.sha, ...textures.map((texture) => texture.sha)].filter(Boolean).join('-');

    sets.push({
      label: directory.name,
      skeleton: `${origin}/assets/${encodeRepoPath(skeleton.path)}`,
      atlas: versionedAssetUrl(origin, atlas, assetVersion),
      animation: defaultAnimation,
      animations,
      textures: textures.map((texture) => texture.name),
      skin: 'default',
      premultipliedAlpha: hasPremultipliedAlpha(atlasText),
      viewport: viewportFromJson(skeletonJson)
        ? { ...viewportFromJson(skeletonJson), padLeft: '14%', padRight: '14%', padTop: '14%', padBottom: '14%' }
        : { padLeft: '14%', padRight: '14%', padTop: '14%', padBottom: '14%' },
    });
  }

  if (sets.length === 0) throw new Error('No Spine sets found');
  try {
    const pathParts = cleanRepoPath(uploadPath).split('/').filter(Boolean);
    const indexPath = joinRepoPath(pathParts.slice(0, -1).join('/'), 'index.json');
    const uploadId = pathParts[pathParts.length - 1] || '';
    const indexText = indexPath ? await githubText(settings, indexPath) : '';
    const entries = indexText ? JSON.parse(indexText) : [];
    const entry = Array.isArray(entries)
      ? entries.find((item) => item?.id === uploadId || cleanRepoPath(item?.previewPath || '') === cleanRepoPath(uploadPath))
      : null;
    note = String(entry?.note || '').trim();
  } catch {
    note = '';
  }
  return createHtml({ sets, note });
}

export default async function handler(request, response) {
  if (request.method !== 'GET') {
    response.setHeader('Allow', 'GET');
    return response.status(405).send('Method not allowed');
  }

  const token = process.env.GITHUB_TOKEN;
  if (!token) return response.status(500).send('GITHUB_TOKEN is not configured');

  const path = cleanRepoPath(request.query?.path || '');
  if (!path) return response.status(400).send('Invalid preview path');

  const settings = {
    owner: process.env.GITHUB_OWNER || defaultOwner,
    repo: process.env.GITHUB_REPO || defaultRepo,
    branch: process.env.GITHUB_BRANCH || defaultBranch,
    token,
  };
  const origin = `${request.headers['x-forwarded-proto'] || 'https'}://${request.headers['x-forwarded-host'] || request.headers.host}`;

  try {
    let html = '';
    if (path.endsWith('/preview.html')) {
      html = await githubText(settings, path);
      if (!html) return response.status(404).send('Preview not found');
    } else {
      html = await createDynamicPreview(settings, path, origin);
    }

    response.setHeader('Content-Type', 'text/html; charset=utf-8');
    response.setHeader('Cache-Control', 'no-store');
    return response.status(200).send(html);
  } catch (error) {
    return response.status(500).send(error instanceof Error ? error.message : 'Preview failed');
  }
}
