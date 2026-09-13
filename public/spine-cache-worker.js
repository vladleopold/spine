const CACHE_VERSION = "spine-link-cache-v2026-05-16-low-power-particles";
const STATIC_CACHE = `${CACHE_VERSION}-static`;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;

const STATIC_URLS = [
  "/site.webmanifest",
  "/favicon-64.png",
  "/page-transitions.css",
  "/spine-link-video-thumbnail.png",
];

const MAX_RUNTIME_OBJECT_BYTES = 10 * 1024 * 1024;
const MAX_RUNTIME_TOTAL_BYTES = 80 * 1024 * 1024;
const MAX_RUNTIME_ENTRIES = 96;

function isSameOrigin(url) {
  return url.origin === self.location.origin;
}

function isCacheableMethod(request) {
  return request.method === "GET";
}

function isRangeRequest(request) {
  return request.headers.has("range");
}

function isNavigationRequest(request) {
  return request.mode === "navigate" || request.destination === "document";
}

function fullAssetRequest(request) {
  const headers = new Headers(request.headers);
  headers.delete("range");
  return new Request(request.url, {
    headers,
    credentials: request.credentials,
    redirect: "follow",
  });
}

function rangeFromHeader(rangeHeader = "", size = 0) {
  const match = String(rangeHeader).match(/^bytes=(\d*)-(\d*)$/);
  if (!match || size <= 0) return null;
  const startText = match[1];
  const endText = match[2];
  let start = startText ? Number(startText) : 0;
  let end = endText ? Number(endText) : size - 1;

  if (!startText && endText) {
    const suffixLength = Number(endText);
    if (!Number.isFinite(suffixLength) || suffixLength <= 0) return null;
    start = Math.max(0, size - suffixLength);
    end = size - 1;
  }

  if (!Number.isFinite(start) || !Number.isFinite(end) || start < 0 || end < start || start >= size) return null;
  return {
    start,
    end: Math.min(end, size - 1),
  };
}

function isStaticRequest(url) {
  return (
    url.pathname.startsWith("/static/") ||
    url.pathname === "/site.webmanifest" ||
    url.pathname === "/page-transitions.css" ||
    url.pathname === "/page-transitions.js" ||
    /^\/favicon(?:-|\.|$)/.test(url.pathname)
  );
}

function isVersionedAssetRequest(url) {
  return url.pathname.startsWith("/assets/") && url.searchParams.has("v");
}

function isPublicFeedRequest(url) {
  return url.pathname === "/api/github-archive" && url.searchParams.get("feed") === "home";
}

function isRuntimeAssetRequest(url) {
  return isVersionedAssetRequest(url) || ["/spine-link-video-thumbnail.png", "/video_tumbnail.png", "/v_holder.webm"].includes(url.pathname);
}

async function putIfSmall(cache, request, response, { trim = false } = {}) {
  if (!response || response.status !== 200 || response.type === "opaque") return response;
  const contentLength = Number(response.headers.get("content-length") || 0);
  if (contentLength > MAX_RUNTIME_OBJECT_BYTES) return response;
  await cache.put(request, response.clone());
  if (trim) await trimRuntimeCache(cache);
  return response;
}

function responseByteSize(response) {
  const size = Number(response?.headers?.get("content-length") || 0);
  return Number.isFinite(size) && size > 0 ? size : 0;
}

async function trimRuntimeCache(cache) {
  const requests = await cache.keys();
  if (requests.length <= MAX_RUNTIME_ENTRIES) {
    const total = await requests.reduce(async (totalPromise, request) => {
      const totalBytes = await totalPromise;
      const response = await cache.match(request);
      return totalBytes + responseByteSize(response);
    }, Promise.resolve(0));
    if (total <= MAX_RUNTIME_TOTAL_BYTES) return;
  }

  const entries = [];
  let totalBytes = 0;
  for (const request of requests) {
    const response = await cache.match(request);
    const size = responseByteSize(response);
    entries.push({ request, size });
    totalBytes += size;
  }

  while (entries.length > MAX_RUNTIME_ENTRIES || totalBytes > MAX_RUNTIME_TOTAL_BYTES) {
    const oldest = entries.shift();
    if (!oldest) break;
    await cache.delete(oldest.request);
    totalBytes -= oldest.size;
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  return putIfSmall(cache, request, response, { trim: cacheName === RUNTIME_CACHE });
}

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    return putIfSmall(cache, request, response, { trim: cacheName === RUNTIME_CACHE });
  } catch {
    const cached = await cache.match(request);
    if (cached) return cached;
    throw new Error("Network request failed and no cached response is available.");
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => putIfSmall(cache, request, response, { trim: cacheName === RUNTIME_CACHE }))
    .catch(() => cached);
  return cached || network;
}

async function partialResponseFromFullResponse(request, response) {
  const buffer = await response.clone().arrayBuffer();
  const range = rangeFromHeader(request.headers.get("range") || "", buffer.byteLength);
  if (!range) {
    return new Response("", {
      status: 416,
      headers: {
        "Content-Range": `bytes */${buffer.byteLength}`,
        "Accept-Ranges": "bytes",
      },
    });
  }

  const headers = new Headers(response.headers);
  headers.set("Accept-Ranges", "bytes");
  headers.set("Content-Range", `bytes ${range.start}-${range.end}/${buffer.byteLength}`);
  headers.set("Content-Length", String(range.end - range.start + 1));
  headers.set("X-Spine-Link-SW-Range", "hit");
  return new Response(buffer.slice(range.start, range.end + 1), {
    status: 206,
    statusText: "Partial Content",
    headers,
  });
}

async function rangeAwareRuntimeAsset(request) {
  const cache = await caches.open(RUNTIME_CACHE);
  const fullRequest = fullAssetRequest(request);
  const cachedFullResponse = await cache.match(fullRequest);
  if (cachedFullResponse) {
    return partialResponseFromFullResponse(request, cachedFullResponse);
  }

  const networkRangeResponse = await fetch(request);
  if (!networkRangeResponse || networkRangeResponse.status !== 200) return networkRangeResponse;

  const contentLength = Number(networkRangeResponse.headers.get("content-length") || 0);
  if (contentLength > MAX_RUNTIME_OBJECT_BYTES) return networkRangeResponse;

  await cache.put(fullRequest, networkRangeResponse.clone());
  await trimRuntimeCache(cache);
  return partialResponseFromFullResponse(request, networkRangeResponse);
}

self.addEventListener("install", (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith("spine-link-cache-")).map((key) => caches.delete(key))))
      .then(() => self.registration.unregister())
      .then(() => self.clients.matchAll({ type: "window" }))
      .then((clients) => clients.forEach((client) => client.navigate(client.url))),
  );
});

self.addEventListener("fetch", (event) => {
  return;
});
