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
