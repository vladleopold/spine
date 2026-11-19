const MEDIA_KEYS = [
  "webmPreview", "webmPreviewMedium", "webmPreviewLow",
  "webpPoster", "webpPosterMedium", "webpPosterLow",
];

function hasSourceTriad(files) {
  const source = Array.isArray(files) ? files : [];
  return source.some(x => /\.(skel|json)$/i.test(x)) &&
    source.some(x => /\.atlas(?:\.txt|\.docx)?$/i.test(x)) &&
    source.some(x => /\.(png|jpe?g|dds|webp)$/i.test(x));
}

// Returns "blocked" only for an explicitly documented, fail-closed state.
// A blocked status with contradictory metadata is a real audit failure.
export function classifyBlockedPreview(record = {}) {
  if (record.webmStatus === "blocked-incompatible-source-version") {
    return String(record.previewError || "").includes("Spine 3.8.75")
      ? "blocked" : "failed";
  }

  if (record.webmStatus === "blocked-missing-source") {
    return hasSourceTriad(record.files) ? "failed" : "blocked";
  }

  if (record.webmStatus === "blocked-missing-animation-selection") {
    const hasAnimation = typeof record.defaultAnimation === "string" &&
      record.defaultAnimation.trim().length > 0;
    const hasGeneratedMedia = MEDIA_KEYS.some(key =>
      typeof record[key] === "string" && record[key].trim().length > 0
    );
    const documented = String(record.previewError || "")
      .includes("No explicit default animation is selected");
    return !hasAnimation && !hasGeneratedMedia &&
      record.previewStatus === "blocked" && documented
      ? "blocked" : "failed";
  }

  return null;
}
