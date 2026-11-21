// Reuse is allowed by default only when the indexed status is already ready.
// Stale/missing/failed statuses must pass the explicit independent media check.
export function storedPreviewStatusAllowsReuse(record, selectedAnimation, { allowFailedStatus = false } = {}) {
  const selected = typeof selectedAnimation === "string" ? selectedAnimation : "";
  const indexed = typeof record?.defaultAnimation === "string" ? record.defaultAnimation : "";
  if (record?.webmStatus !== "ready" || !selected || indexed !== selected) return false;
  if (allowFailedStatus) return true;
  return record?.previewStatus === "ready";
}

const mediaFields = [
  ["webmPreview", "webm", "preview"],
  ["webmPreviewMedium", "webm", "preview-medium"],
  ["webmPreviewLow", "webm", "preview-low"],
  ["webpPoster", "webp", "preview"],
  ["webpPosterMedium", "webp", "preview-medium"],
  ["webpPosterLow", "webp", "preview-low"],
];

// Resolve the exact URLs stored for the selected animation. Legacy exports may
// use an animation-prefixed filename and a nested source directory; accept them
// only when all six assets share one work-local directory and one filename stem.
export function resolveStoredPreviewMediaFiles(entry, record, selectedAnimation) {
  const selected = typeof selectedAnimation === "string" ? selectedAnimation : "";
  const previewPath = typeof entry?.previewPath === "string"
    ? entry.previewPath.replace(/\\/g, "/") : "";
  if (!selected || record?.defaultAnimation !== selected || !previewPath ||
      previewPath.startsWith("/") || previewPath.includes("\\") ||
      previewPath.split("/").some(part => !part || part === "." || part === "..")) return null;

  const animationMap = record?.allAnimationPreviews;
  const hasAnimationMap = animationMap && typeof animationMap === "object" &&
    !Array.isArray(animationMap) && Object.keys(animationMap).length > 0;
  const media = hasAnimationMap ? animationMap[selected] : record;
  if (!media || typeof media !== "object") return null;

  let directory = "";
  let commonPrefix = null;
  const files = {};
  for (const [field, extension, suffix] of mediaFields) {
    const value = media[field];
    if (typeof value !== "string" || !value) return null;
    let url;
    try { url = new URL(value); } catch { return null; }
    if (url.origin !== "https://spine-link.vercel.app" ||
        !url.pathname.startsWith("/assets/")) return null;

    let parts;
    try {
      parts = url.pathname.slice("/assets/".length).split("/").map(decodeURIComponent);
    } catch { return null; }
    if (parts.some(part => !part || part === "." || part === ".." ||
        part.includes("/") || part.includes("\\"))) return null;
    const filename = parts.pop();
    const extensionSuffix = "." + extension;
    if (!filename.toLowerCase().endsWith(extensionSuffix)) return null;
    const stem = filename.slice(0, -extensionSuffix.length).toLowerCase();
    const wantedSuffix = suffix.toLowerCase();
    const prefix = stem === wantedSuffix ? "" :
      stem.endsWith("-" + wantedSuffix) ? stem.slice(0, -(wantedSuffix.length + 1)) : null;
    if (prefix === null) return null;
    if (commonPrefix === null) commonPrefix = prefix;
    else if (commonPrefix !== prefix) return null;

    const candidateDirectory = parts.join("/");
    if (!candidateDirectory ||
        (candidateDirectory !== previewPath && !candidateDirectory.startsWith(previewPath + "/"))) return null;
    if (directory && directory !== candidateDirectory) return null;
    directory = candidateDirectory;
    files[field] = [...parts, filename].join("/");
  }

  for (const [video, poster] of [
    ["webmPreview", "webpPoster"],
    ["webmPreviewMedium", "webpPosterMedium"],
    ["webmPreviewLow", "webpPosterLow"],
  ]) {
    if (files[video].replace(/\.webm$/i, "") !== files[poster].replace(/\.webp$/i, "")) return null;
  }
  return { directory, files };
}


// Backward-compatible directory view for existing callers; the authoritative
// result is the exact six-file map above.
export function resolveStoredPreviewMediaDirectory(entry, record, selectedAnimation) {
  return resolveStoredPreviewMediaFiles(entry, record, selectedAnimation)?.directory || "";
}
