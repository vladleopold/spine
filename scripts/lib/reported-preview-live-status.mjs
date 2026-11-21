const TEMPORARY_HTTP_STATUSES = new Set([401, 402, 403, 408, 425, 429]);

export function classifyOriginHttpStatus(status) {
  const code = Number(status);
  return Number.isInteger(code) && code >= 200 && code < 300 ? "ok" : "blocked";
}

export function classifyPreviewHttpStatus(status) {
  const code = Number(status);
  if (code === 200 || code === 206) return "ok";
  if (code === 0 || TEMPORARY_HTTP_STATUSES.has(code) || code >= 500) return "blocked";
  return "failed";
}

export function hasExactPreviewAnimation(entry) {
  const selected = typeof entry?.defaultAnimation === "string" ? entry.defaultAnimation : "";
  const animations = Array.isArray(entry?.animations) ? entry.animations : [];
  return Boolean(selected) &&
    animations.includes(selected) &&
    entry?.webmAnimation === selected;
}

export function classifyReportedPreviewEntry(entry) {
  const webmStatus = typeof entry?.webmStatus === "string" ? entry.webmStatus : "";
  const previewStatus = typeof entry?.previewStatus === "string" ? entry.previewStatus : "";
  const selected = typeof entry?.defaultAnimation === "string" ? entry.defaultAnimation : "";
  const animations = Array.isArray(entry?.animations) ? entry.animations : [];
  const webmAnimation = typeof entry?.webmAnimation === "string" ? entry.webmAnimation : "";

  if (
    webmStatus === "failed" ||
    previewStatus === "failed" ||
    (webmAnimation && selected && webmAnimation !== selected) ||
    (selected && animations.length > 0 && !animations.includes(selected))
  ) return "failed";

  if (
    webmStatus.startsWith("blocked-") ||
    previewStatus === "blocked" ||
    webmStatus === "pending" ||
    previewStatus === "pending" ||
    !hasExactPreviewAnimation(entry)
  ) return "blocked";

  if (webmStatus === "ready" && (!previewStatus || previewStatus === "ready")) return "ready";
  return "blocked";
}
