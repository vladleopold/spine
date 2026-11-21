// A failed or blocked stored status is never reusable, even when the
// work-level WebM flag and file URLs still look ready. Legacy records that
// predate previewStatus remain eligible for independent byte/decode checks.
export function storedPreviewStatusAllowsReuse(record, selectedAnimation) {
  const selected = typeof selectedAnimation === "string" ? selectedAnimation : "";
  const indexed = typeof record?.defaultAnimation === "string" ? record.defaultAnimation : "";
  if (record?.webmStatus !== "ready" || !selected || indexed !== selected) return false;
  const status = record?.previewStatus;
  return status === undefined || status === null || status === "" || status === "ready";
}
