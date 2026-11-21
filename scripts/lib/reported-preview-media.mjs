const ASSET_ORIGIN = "https://spine-link.vercel.app";
const ASSET_PREFIX = "/assets/library_02/";
const VIDEO_NAMES = new Set(["preview.webm", "preview-medium.webm", "preview-low.webm"]);

export function isSameWorkMediaPair(webmUrl, webpUrl) {
  try {
    const webm = new URL(webmUrl);
    const webp = new URL(webpUrl);
    if (webm.origin !== ASSET_ORIGIN || webp.origin !== ASSET_ORIGIN) return false;
    const webmPath = decodeURIComponent(webm.pathname);
    const webpPath = decodeURIComponent(webp.pathname);
    if (!webmPath.startsWith(ASSET_PREFIX) || !webpPath.startsWith(ASSET_PREFIX)) return false;
    const webmSlash = webmPath.lastIndexOf("/");
    const webpSlash = webpPath.lastIndexOf("/");
    const webmName = webmPath.slice(webmSlash + 1);
    const webpName = webpPath.slice(webpSlash + 1);
    return webmPath.slice(0, webmSlash) === webpPath.slice(0, webpSlash) &&
      VIDEO_NAMES.has(webmName) &&
      webpName === webmName.replace(/\.webm$/i, ".webp");
  } catch {
    return false;
  }
}

export function hasWebmSignature(bytes) {
  return Boolean(bytes && bytes.length >= 256 &&
    bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3);
}

export function hasWebpSignature(bytes) {
  return Boolean(bytes && bytes.length >= 256 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP");
}
