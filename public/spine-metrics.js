(function () {
  const visitorKey = "spine-link-metrics-visitor";

  function randomId() {
    const cryptoApi = window.crypto || window.msCrypto;
    if (cryptoApi?.getRandomValues) {
      const bytes = new Uint8Array(16);
      cryptoApi.getRandomValues(bytes);
      return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
    }
    return Math.random().toString(36).slice(2) + Date.now().toString(36);
  }

  function visitorId() {
    try {
      const existing = window.localStorage.getItem(visitorKey);
      if (existing) return existing;
      const next = randomId();
      window.localStorage.setItem(visitorKey, next);
      return next;
    } catch {
      return randomId();
    }
  }

  function uniqueMetricIds() {
    const seen = new Set();
    document.querySelectorAll("[data-metric-id]").forEach((element) => {
      const id = String(element.dataset.metricId || "").trim();
      if (id) seen.add(id);
    });
    return Array.from(seen);
  }

  function metricNumber(value) {
    return Math.max(0, Number(value || 0) || 0);
  }

  function applyMetric(id, metric) {
    const likes = metricNumber(metric?.likes);
    const views = metricNumber(metric?.views);
    const liked = Boolean(metric?.liked);

    document.querySelectorAll("[data-metric-id]").forEach((element) => {
      if (element.dataset.metricId !== id) return;
      element.dataset.metricCurrentLikes = String(likes);
      element.dataset.metricCurrentViews = String(views);

      const likesNode = element.querySelector("[data-metric-likes]");
      const viewsNode = element.querySelector("[data-metric-views]");
      if (likesNode) likesNode.textContent = String(likes);
      if (viewsNode) viewsNode.textContent = String(views);

      if (element.hasAttribute("data-metric-like")) {
        element.classList.toggle("is-liked", liked);
        element.setAttribute("aria-pressed", String(liked));
        element.title = liked ? "Liked" : "Like";
        const icon = element.querySelector("[data-metric-like-icon]");
        if (icon) icon.textContent = liked ? "♥" : "♡";
      }

      const label = element.dataset.metricLabel;
      if (label === "stats") element.setAttribute("aria-label", likes + " likes and " + views + " views");
    });
  }

  async function requestMetrics(ids, currentVisitorId) {
    if (!ids.length) return;
    const response = await fetch("/api/github-upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "get-metrics", ids, visitorId: currentVisitorId }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Could not load metrics");
    Object.entries(payload.metrics || {}).forEach(([id, metric]) => applyMetric(id, metric));
  }

  async function postMetric(action, id, currentVisitorId, body) {
    const response = await fetch("/api/github-upload", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "track-metric", metricAction: action, entryId: id, visitorId: currentVisitorId, ...body }),
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(payload.error || "Could not update metrics");
    if (payload.metric) applyMetric(id, payload.metric);
    return payload.metric;
  }

  function attachLikeButtons(currentVisitorId) {
    document.querySelectorAll("[data-metric-like]").forEach((button) => {
      if (button.dataset.metricReady === "true") return;
      button.dataset.metricReady = "true";
      const like = async (event) => {
        event.preventDefault();
        event.stopPropagation();
        if (button.dataset.metricBusy === "true") return;
        const id = String(button.dataset.metricId || "").trim();
        if (!id) return;

        const wasLiked = button.getAttribute("aria-pressed") === "true";
        const nextLiked = !wasLiked;
        const currentLikes = metricNumber(button.dataset.metricCurrentLikes || button.querySelector("[data-metric-likes]")?.textContent);
        const currentViews = metricNumber(button.dataset.metricCurrentViews || button.querySelector("[data-metric-views]")?.textContent);
        applyMetric(id, { likes: currentLikes + (nextLiked ? 1 : -1), views: currentViews, liked: nextLiked });
        button.dataset.metricBusy = "true";

        try {
          await postMetric("like", id, currentVisitorId, { liked: nextLiked });
        } catch {
          applyMetric(id, { likes: currentLikes, views: currentViews, liked: wasLiked });
        } finally {
          button.dataset.metricBusy = "false";
        }
      };
      button.addEventListener("click", like);
      button.addEventListener("keydown", (event) => {
        if (event.key !== "Enter" && event.key !== " ") return;
        like(event);
      });
    });
  }

  function start() {
    const ids = uniqueMetricIds();
    if (!ids.length && !window.SpineLinkMetricsConfig?.viewId) return;
    const currentVisitorId = visitorId();
    attachLikeButtons(currentVisitorId);
    requestMetrics(ids, currentVisitorId).catch(() => {});

    const viewId = String(window.SpineLinkMetricsConfig?.viewId || "").trim();
    if (viewId) postMetric("view", viewId, currentVisitorId, {}).catch(() => {});
  }

  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", start, { once: true });
  } else {
    start();
  }
})();
