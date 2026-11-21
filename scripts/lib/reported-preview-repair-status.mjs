// A failed or blocked stored status is never reusable by default. The caller
// may opt into a separate byte/decode/motion/poster verification pass; that
// pass still requires the exact indexed animation and a ready WebM source.
export function storedPreviewStatusAllowsReuse(record, selectedAnimation, { allowFailedStatus = false } = {}) {
  const selected = typeof selectedAnimation === "string" ? selectedAnimation : "";
  const indexed = typeof record?.defaultAnimation === "string" ? record.defaultAnimation : "";
  if (record?.webmStatus !== "ready" || !selected || indexed !== selected) return false;
  if (allowFailedStatus) return true;
  const status = record?.previewStatus;
  return status === undefined || status === null || status === "" || status === "ready";
}

const mediaFiles = {
  webmPreview: "preview.webm",
  webmPreviewMedium: "preview-medium.webm",
  webmPreviewLow: "preview-low.webm",
  webpPoster: "preview.webp",
  webpPosterMedium: "preview-medium.webp",
  webpPosterLow: "preview-low.webp",
};

// Resolve only the URLs indexed for this exact animation. If an animation map
// exists but lacks the selected key, never fall back to work-level media.
export function resolveStoredPreviewMediaDirectory(entry, record, selectedAnimation) {
  const selected = typeof selectedAnimation === "string" ? selectedAnimation : "";
  const previewPath = typeof entry?.previewPath === "string"
    ? entry.previewPath.replace(/\\/g, "/") : "";
  if (!selected || record?.defaultAnimation !== selected || !previewPath ||
      previewPath.startsWith("/") || previewPath.split("/").some(part =>
        !part || part === "." || part === "..")) return "";

  const animationMap = record?.allAnimationPreviews;
  const hasAnimationMap = animationMap && typeof animationMap === "object" &&
    !Array.isArray(animationMap) && Object.keys(animationMap).length > 0;
  const media = hasAnimationMap ? animationMap[selected] : record;
  if (!media || typeof media !== "object") return "";

  let directory = "";
  for (const [field, filename] of Object.entries(mediaFiles)) {
    const value = media[field];
    if (typeof value !== "string" || !value) return "";
    let url;
    try { url = new URL(value); } catch { return ""; }
    if (url.origin !== "https://spine-link.vercel.app" ||
        !url.pathname.startsWith("/assets/")) return "";

    let parts;
    try {
      parts = url.pathname.slice("/assets/".length).split("/").map(decodeURIComponent);
    } catch { return ""; }
    if (parts.some(part => !part || part === "." || part === ".." ||
        part.includes("/") || part.includes("\\"))) return "";
    const actualFilename = parts.pop();
    if (actualFilename !== filename) return "";
    const candidateDirectory = parts.join("/");
    if (candidateDirectory !== previewPath &&
        !candidateDirectory.startsWith(previewPath + "/")) return "";
    if (directory && directory !== candidateDirectory) return "";
    directory = candidateDirectory;
  }
  return directory;
}
