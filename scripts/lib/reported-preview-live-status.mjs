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

export function classifyReportedPreviewEntry(entry) {
  const webmStatus = typeof entry?.webmStatus === "string" ? entry.webmStatus : "";
  const previewStatus = typeof entry?.previewStatus === "string" ? entry.previewStatus : "";

  if (webmStatus === "failed" || previewStatus === "failed") return "failed";
  if (
    webmStatus.startsWith("blocked-") ||
    previewStatus === "blocked" ||
    webmStatus === "pending" ||
    previewStatus === "pending"
  ) return "blocked";

  // Older accepted records may predate previewStatus. A ready WebM remains
  // eligible only when the newer field is absent or explicitly ready.
  if (webmStatus === "ready" && (!previewStatus || previewStatus === "ready")) return "ready";
  return "blocked";
}
