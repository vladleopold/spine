import "./styles.css";

const root = document.getElementById("root");
let isAppLoading = false;
let isAppMounted = false;
let bootDraggingState: boolean | null = null;
let stopBootParticles: (() => void) | null = null;

function renderBootShell(isDragging = false) {
  if (!root || isAppMounted) return;
  if (bootDraggingState === isDragging && root.querySelector(".app-shell")) return;
  bootDraggingState = isDragging;
  stopBootParticles?.();

  root.innerHTML = `
    <main class="app-shell is-empty ${isDragging ? "is-docking" : ""}">
      <canvas class="particle-field" aria-hidden="true"></canvas>
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
  startBootParticles();
}

function renderLoadingShell() {
  if (!root) return;
  bootDraggingState = null;
  stopBootParticles?.();
  root.innerHTML = `
    <main class="app-shell is-empty">
      <canvas class="particle-field" aria-hidden="true"></canvas>
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
  startBootParticles();
}

function startBootParticles() {
  const canvas = root?.querySelector<HTMLCanvasElement>(".particle-field");
  const context = canvas?.getContext("2d");
  if (!canvas || !context) return;

  const colors = ["255,255,255", "140,199,255", "255,106,40"];
  const particles: Array<{
    x: number;
    y: number;
    radius: number;
    speedX: number;
    speedY: number;
    alpha: number;
    pulse: number;
    color: string;
  }> = [];
  let width = 0;
  let height = 0;
  let pixelRatio = 1;
  let animationFrame = 0;

  const resetParticle = (particle: (typeof particles)[number], randomizePosition = false) => {
    particle.x = Math.random() * width;
    particle.y = randomizePosition ? Math.random() * height : height + Math.random() * 80;
    particle.radius = 0.55 + Math.random() * 1.8;
    particle.speedX = (Math.random() - 0.5) * 0.16;
    particle.speedY = -(0.08 + Math.random() * 0.34);
    particle.alpha = 0.18 + Math.random() * 0.64;
    particle.pulse = Math.random() * Math.PI * 2;
    particle.color = colors[Math.floor(Math.random() * colors.length)];
  };

  const resize = () => {
    pixelRatio = Math.min(window.devicePixelRatio || 1, 2);
    width = window.innerWidth;
    height = window.innerHeight;
    canvas.width = Math.floor(width * pixelRatio);
    canvas.height = Math.floor(height * pixelRatio);
    canvas.style.width = `${width}px`;
    canvas.style.height = `${height}px`;
    context.setTransform(pixelRatio, 0, 0, pixelRatio, 0, 0);

    const targetCount = Math.min(170, Math.max(72, Math.floor((width * height) / 9000)));
    while (particles.length < targetCount) {
      const particle = {} as (typeof particles)[number];
      resetParticle(particle, true);
      particles.push(particle);
    }
    particles.length = targetCount;
  };

  const draw = (time: number) => {
    context.clearRect(0, 0, width, height);

    for (const particle of particles) {
      particle.x += particle.speedX + Math.sin(time * 0.00025 + particle.pulse) * 0.035;
      particle.y += particle.speedY;

      if (particle.y < -24 || particle.x < -32 || particle.x > width + 32) {
        resetParticle(particle);
      }

      const alpha = particle.alpha * (0.68 + Math.sin(time * 0.0012 + particle.pulse) * 0.32);
      const glowRadius = particle.radius * 5.5;
      const gradient = context.createRadialGradient(particle.x, particle.y, 0, particle.x, particle.y, glowRadius);
      gradient.addColorStop(0, `rgba(${particle.color}, ${alpha})`);
      gradient.addColorStop(0.42, `rgba(${particle.color}, ${alpha * 0.24})`);
      gradient.addColorStop(1, `rgba(${particle.color}, 0)`);
      context.fillStyle = gradient;
      context.beginPath();
      context.arc(particle.x, particle.y, glowRadius, 0, Math.PI * 2);
      context.fill();
    }

    animationFrame = window.requestAnimationFrame(draw);
  };

  resize();
  animationFrame = window.requestAnimationFrame(draw);
  window.addEventListener("resize", resize);

  stopBootParticles = () => {
    window.cancelAnimationFrame(animationFrame);
    window.removeEventListener("resize", resize);
    stopBootParticles = null;
  };
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
  stopBootParticles?.();
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
