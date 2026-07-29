import React from "react";
const root = document.getElementById("root");
export {};
let isAppLoading = false;
let isAppMounted = false;
let mountedFileReceiver: ((files: File[]) => void) | null = null;
let pendingMountedFiles: File[] | null = null;
let bootDraggingState: boolean | null = null;
let stopBootParticles: (() => void) | null = null;
let bootParticleStartFrame = 0;

declare global {
  interface Window {
    __spineLinkReceiveFiles?: (files: File[]) => void;
  }
}

function receiveFiles(files: File[]) {
  if (!files.length) return;
  if (isAppMounted && window.__spineLinkReceiveFiles) {
    window.__spineLinkReceiveFiles(files);
    return;
  }
  if (isAppMounted) {
    pendingMountedFiles = files;
    window.setTimeout(() => {
      if (pendingMountedFiles && window.__spineLinkReceiveFiles) {
        const nextFiles = pendingMountedFiles;
        pendingMountedFiles = null;
        window.__spineLinkReceiveFiles(nextFiles);
      }
    }, 0);
    return;
  }
  if (mountedFileReceiver) {
    mountedFileReceiver(files);
    return;
  }
  void mountApp(files);
}

function renderBootShell(isDragging = false) {
  if (!root || isAppMounted) return;
  if (bootDraggingState === isDragging && root.querySelector(".app-shell")) return;
  bootDraggingState = isDragging;
  stopBootParticles?.();

  root.innerHTML = `
    <main class="app-shell is-empty ${isDragging ? "is-docking" : ""}">
      <section class="seo-intro" aria-label="Spine-Link SEO description">
        <h1>Spine-Link is an animation portfolio platform with Google accounts and uploads</h1>
        <p>World SPINE ARCHIVE is the public archive of user Spine animation works. Anyone can create an anonymous preview with the Create preview button, or sign in with Google to create a profile, choose public portfolio mode with likes, views, showcase and archive publishing, or keep a private library profile that is not listed on the site or in Google.</p>
      </section>
      <section class="workspace">
        <header class="topbar">
          <a class="brand-link" href="/" aria-label="Spine-Link home">
            <span class="brand-mobile-text">spine link</span>
            <span class="brand-logo" aria-hidden="true">
              <span>S</span><span>P</span>
              <span class="brand-spine-mark"><i></i><i></i><i></i><i></i><i></i></span>
              <span>N</span><span>E</span><span class="brand-plus">LINK</span>
            </span>
            <img class="brand-logo-image brand-logo-mobile" src="/logo-mobile.png" alt="Spine-Link logo" aria-hidden="true">
          </a>
          <details class="site-menu">
            <summary class="site-menu-toggle" aria-label="Open site menu" title="Menu">
              <span></span><span></span><span></span>
            </summary>
            <nav class="site-menu-panel" aria-label="Site pages">
              <a href="/spine-animation-dataset.html">
                <strong>Buy Spine Dataset</strong>
                <span>Commercial source database</span>
              </a>
              <a href="/spine-web-viewer.html">
                <strong>Web Viewer</strong>
                <span>Open Spine files online</span>
              </a>
              <a href="/spine-animation-preview.html">
                <strong>Animation Preview</strong>
                <span>Preview Spine animations</span>
              </a>
              <a href="/share-spine-animation-link.html">
                <strong>Share Link Guide</strong>
                <span>Create and share Spine animation URL</span>
              </a>
              <a href="/site-map.html">
                <strong>Site Map</strong>
                <span>All SEO pages in one list</span>
              </a>
            </nav>
          </details>
          <div class="auth-panel">
            <a class="my-library-button" href="/?portfolio=1" data-open-library>MY PORTFOLIO</a>
            <a class="google-fallback-button" href="/?login=google" data-open-login><span aria-hidden="true">G</span><span>Sign in with Google</span></a>
          </div>
        </header>
        <div class="stage">
          <div class="home-drop-panel">
            <label class="drop-zone boot-drop-zone main-drop-zone ${isDragging ? "is-dragging" : ""}">
              <input name="spine-files" type="file" multiple accept=".json,.skel,.atlas,.txt,.docx,.png,.jpg,.jpeg,.webp" aria-label="Upload Spine JSON SKEL atlas and texture files" data-file-input>
              <svg class="boot-upload-icon" viewBox="0 0 24 24" aria-hidden="true">
                <path d="M12 3v13m0-13 5 5m-5-5-5 5M5 15v4h14v-4" />
              </svg>
              <strong>Drag'and'Drop files here</strong>
              <span>JSON or SKEL, atlas, and textures become a Spine preview.</span>
            </label>
          </div>
        </div>
      </section>
    </main>
  `;

  root.querySelectorAll<HTMLElement>("[data-open-app], [data-open-library], [data-open-login], [data-open-upload]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.preventDefault();
      void mountApp([], {
        openLibrary: button.hasAttribute("data-open-library"),
        login: button.hasAttribute("data-open-login"),
        upload: button.hasAttribute("data-open-upload"),
      });
    });
  });
  root.querySelectorAll<HTMLFormElement>("[data-upload-form]").forEach((form) => {
    form.addEventListener("submit", (event) => {
      event.preventDefault();
      void mountApp([], { upload: true });
    });
  });
  const bootFileInput = root.querySelector<HTMLInputElement>("[data-file-input]");
  const handleBootFileInput = (event: Event) => {
    const input = event.currentTarget as HTMLInputElement;
    const files = Array.from(input.files ?? []);
    window.setTimeout(() => {
      input.value = "";
    }, 0);
    receiveFiles(files);
  };
  bootFileInput?.addEventListener("click", () => {
    bootFileInput.value = "";
  });
  bootFileInput?.addEventListener("input", handleBootFileInput);
  bootFileInput?.addEventListener("change", handleBootFileInput);
  startBootParticles();
}

function renderLoadingShell() {
  if (!root) return;
  bootDraggingState = null;
  stopBootParticles?.();
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
  startBootParticles();
}

function startBootParticles() {
  window.cancelAnimationFrame(bootParticleStartFrame);
  stopBootParticles?.();
  stopBootParticles = null;
}

const GOOGLE_CLIENT_ID = "452954491878-ebeqoeg5h7pr968uev0qbmtpsadg5mj3.apps.googleusercontent.com";
const SESSION_KEY = "spine-link-google-session";

type StoredSession = { user: { email: string; name?: string; picture?: string }; accessToken: string; expiresAt: number };

function readSession(): StoredSession | null {
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw) as StoredSession;
    if (s.expiresAt && s.expiresAt > Date.now()) return s;
    localStorage.removeItem(SESSION_KEY);
  } catch {}
  return null;
}

function AdminPanelWrapper({ AdminPanel }: { AdminPanel: React.ComponentType<any> }) {
  const [user, setUser] = React.useState<{ email: string; name?: string; picture?: string } | null>(null);
  const [loading, setLoading] = React.useState(true);
  const [error, setError] = React.useState("");
  const tokenClientRef = React.useRef<any>(null);

  React.useEffect(() => {
    // First check if we have a valid server session
    fetch("/api/github-upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ action: "admin-session-check" }),
    }).then(r => r.json()).then(data => {
      if (data.ok && data.email) {
        setUser({ email: data.email });
      }
      setLoading(false);
    }).catch(() => setLoading(false));
  }, []);

  const handleGoogleLogin = React.useCallback(() => {
    if (tokenClientRef.current) {
      tokenClientRef.current.requestAccessToken();
      return;
    }
    const script = document.createElement("script");
    script.src = "https://accounts.google.com/gsi/client";
    script.onload = () => {
      tokenClientRef.current = (window as any).google?.accounts?.oauth2?.initTokenClient({
        client_id: GOOGLE_CLIENT_ID,
        scope: "openid email profile",
        callback: async (response: any) => {
          if (response.error || !response.access_token) { setError("Sign-in failed"); return; }
          try {
            // Exchange Google token for server session (httpOnly cookie)
            const res = await fetch("/api/github-upload", {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              credentials: "same-origin",
              body: JSON.stringify({ action: "admin-login", googleAccessToken: response.access_token }),
            });
            const data = await res.json();
            if (data.ok && data.email) {
              setUser({ email: data.email });
              setError("");
              // Clear any old localStorage session
              localStorage.removeItem(SESSION_KEY);
            } else {
              setError(data.error || "Not authorized");
            }
          } catch { setError("Connection error"); }
        },
      });
      tokenClientRef.current?.requestAccessToken();
    };
    document.head.appendChild(script);
  }, []);

  const handleSignOut = React.useCallback(() => {
    fetch("/api/github-upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ action: "admin-logout" }),
    }).catch(() => {});
    setUser(null);
    localStorage.removeItem(SESSION_KEY);
    try { (window as any).google?.accounts?.id?.disableAutoSelect(); } catch {}
  }, []);

  if (loading) return <div style={{ padding: 40, color: "#888" }}>Loading...</div>;
  if (!user) {
    return (
      <div className="admin-login-screen">
        <h1>Administrator Access</h1>
        <p>Sign in with an authorized Google account to access the admin panel.</p>
        {error && <p style={{ color: "#e74c3c", marginBottom: 16 }}>{error}</p>}
        <button className="admin-btn admin-btn-primary" onClick={handleGoogleLogin}>
          Sign in with Google
        </button>
        <div style={{ marginTop: 16 }}>
          <a className="admin-btn admin-btn-ghost" href="/">← Back to site</a>
        </div>
      </div>
    );
  }
  return <AdminPanel googleUser={user} onSignOut={handleSignOut} />;
}

async function mountApp(initialFiles: File[] = [], options: { openLibrary?: boolean; login?: boolean; upload?: boolean } = {}) {
  if (!root || isAppLoading || isAppMounted) return;
  isAppLoading = true;
  renderLoadingShell();

  const [{ createElement, StrictMode }, { createRoot }, { App }] = await Promise.all([
    import("react"),
    import("react-dom/client"),
    import("./SpineApp"),
  ]);

  isAppMounted = true;
  window.cancelAnimationFrame(bootParticleStartFrame);
  stopBootParticles?.();
  mountedFileReceiver = (files: File[]) => {
    window.__spineLinkReceiveFiles?.(files);
  };

  createRoot(root).render(
    createElement(
      StrictMode,
      null,
      createElement(App, {
        initialFiles,
        initialOpenLibrary: options.openLibrary,
        initialLogin: options.login,
        initialUpload: options.upload,
      }),
    ),
  );
}

const bootSearchParams = new URLSearchParams(window.location.search);
const shouldOpenLogin = bootSearchParams.get("login") === "google";
const shouldOpenPortfolio = bootSearchParams.has("portfolio") || bootSearchParams.has("library");
const shouldOpenUpload = bootSearchParams.get("upload") === "work";
const shouldOpenAdmin = bootSearchParams.has("admin");

if (shouldOpenAdmin) {
  void (async () => {
    const [{ createElement }, { createRoot }, { default: AdminPanel }] = await Promise.all([
      import("react"),
      import("react-dom/client"),
      import("./AdminPanel"),
    ]);
    const rootEl = document.getElementById("root");
    if (rootEl) {
      rootEl.innerHTML = "";
      createRoot(rootEl).render(createElement(AdminPanelWrapper, { AdminPanel }));
    }
  })();
} else {
  renderBootShell();

  if (bootSearchParams.has("edit") || shouldOpenLogin || shouldOpenPortfolio || shouldOpenUpload) {
    void mountApp([], { login: shouldOpenLogin, openLibrary: shouldOpenPortfolio, upload: shouldOpenUpload });
  } else {
    const mountHomepageApp = () => {
      void mountApp();
    };
    if ("requestIdleCallback" in window) {
      window.requestIdleCallback(mountHomepageApp, { timeout: 1200 });
    } else {
      globalThis.setTimeout(mountHomepageApp, 250);
    }
  }
}

document.addEventListener("dragover", (event) => {
  event.preventDefault();
  renderBootShell(true);
});

document.addEventListener("dragleave", (event) => {
  if (!root || root.contains(event.relatedTarget as Node | null)) return;
  renderBootShell(false);
});

document.addEventListener("drop", (event) => {
  const files = Array.from(event.dataTransfer?.files ?? []);
  if (!files.length) return;
  event.preventDefault();
  event.stopPropagation();
  renderBootShell(false);
  receiveFiles(files);
});

function clearSpineCacheWorker() {
  if (!("serviceWorker" in navigator)) return;
  const clear = () => {
    navigator.serviceWorker.getRegistrations()
      .then((registrations) => Promise.all(registrations.map((registration) => registration.unregister())))
      .then(() => caches?.keys?.())
      .then((keys) => Promise.all((keys ?? []).filter((key) => key.startsWith("spine-link-cache-")).map((key) => caches.delete(key))))
      .catch(() => undefined);
  };
  if ("requestIdleCallback" in window) {
    window.requestIdleCallback(clear, { timeout: 1600 });
  } else {
    globalThis.setTimeout(clear, 800);
  }
}

clearSpineCacheWorker();
