import "./styles.css";

const root = document.getElementById("root");
let isAppLoading = false;
let isAppMounted = false;

function renderBootShell(isDragging = false) {
  if (!root || isAppMounted) return;

  root.innerHTML = `
    <main class="app-shell is-empty ${isDragging ? "is-docking" : ""}">
      <section class="seo-intro" aria-label="Spine-Link SEO description">
        <h1>Spine-Link online Spine preview and Spine web viewer</h1>
        <p>Spine-Link is a browser based Spine preview tool for Spine online workflows, Spine web previews, Spine webview links, JSON and SKEL animation files, atlas files, and texture images.</p>
      </section>
      <section class="workspace">
        <header class="topbar">
          <a class="brand-link" href="/" aria-label="Spine-Link home">
            <span class="brand-logo" aria-hidden="true">
              <span>s</span><span>p</span>
              <span class="brand-spine-mark"><i></i><i></i><i></i><i></i><i></i></span>
              <span>n</span><span>e</span><span class="brand-plus">link</span>
            </span>
          </a>
          <div class="auth-panel">
            <button class="my-library-button" type="button" data-open-app>My Library</button>
            <button class="google-fallback-button" type="button" data-open-app><span aria-hidden="true">G</span>Library with Google</button>
          </div>
        </header>
        <div class="stage">
          <div class="preview-panel" style="--preview-pattern-size: 140px">
            <div class="empty-state">
              <span class="boot-icon" aria-hidden="true">SP</span>
              <span>Waiting for Spine files</span>
            </div>
            <div class="player-host" aria-label="Spine preview canvas"></div>
          </div>
          <aside class="inspector">
            <label class="drop-zone ${isDragging ? "is-dragging" : ""}">
              <input type="file" multiple accept=".json,.skel,.atlas,.txt,.docx,.png,.jpg,.jpeg,.webp" data-file-input>
              <span class="boot-mini-icon" aria-hidden="true">+</span>
              <strong>Drag files here</strong>
              <span>json/skel, atlas, and one or more texture images</span>
            </label>
            <div class="asset-list">
              <div class="asset-row">
                <span class="boot-row-icon" aria-hidden="true"></span>
                <span>No files selected yet</span>
              </div>
            </div>
          </aside>
        </div>
      </section>
      <a class="site-credit" href="https://t.me/vladleopold" target="_blank" rel="noreferrer">by leopold</a>
    </main>
  `;

  root.querySelectorAll<HTMLElement>("[data-open-app]").forEach((button) => {
    button.addEventListener("click", () => void mountApp());
  });
  root.querySelector<HTMLInputElement>("[data-file-input]")?.addEventListener("change", (event) => {
    const input = event.currentTarget as HTMLInputElement;
    if (input.files?.length) void mountApp(Array.from(input.files));
  });
}

function renderLoadingShell() {
  if (!root) return;
  root.innerHTML = `
    <main class="app-shell is-empty">
      <section class="workspace">
        <div class="stage">
          <div class="preview-panel">
            <div class="empty-state">
              <span class="boot-icon" aria-hidden="true">SP</span>
              <span>Loading Spine-Link</span>
            </div>
          </div>
        </div>
      </section>
    </main>
  `;
}

async function mountApp(initialFiles: File[] = []) {
  if (!root || isAppLoading || isAppMounted) return;
  isAppLoading = true;
  renderLoadingShell();

  const [{ createElement, StrictMode }, { createRoot }, { App }] = await Promise.all([
    import("react"),
    import("react-dom/client"),
    import("./SpineApp"),
  ]);

  isAppMounted = true;
  createRoot(root).render(createElement(StrictMode, null, createElement(App, { initialFiles })));
}

renderBootShell();

document.addEventListener("dragover", (event) => {
  event.preventDefault();
  renderBootShell(true);
});

document.addEventListener("dragleave", (event) => {
  if (!root || root.contains(event.relatedTarget as Node | null)) return;
  renderBootShell(false);
});

document.addEventListener("drop", (event) => {
  event.preventDefault();
  renderBootShell(false);
  if (event.dataTransfer?.files.length) void mountApp(Array.from(event.dataTransfer.files));
});
