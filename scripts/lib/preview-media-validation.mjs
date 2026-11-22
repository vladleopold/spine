import path from "node:path";
import { createHash } from "node:crypto";

const TIERS = [
  { webmFile: "preview.webm", posterFile: "preview.webp", webmKey: "webmPreview", posterKey: "webpPoster" },
  { webmFile: "preview-medium.webm", posterFile: "preview-medium.webp", webmKey: "webmPreviewMedium", posterKey: "webpPosterMedium" },
  { webmFile: "preview-low.webm", posterFile: "preview-low.webp", webmKey: "webmPreviewLow", posterKey: "webpPosterLow" },
];

const SAFE_FAILURE_STAGES = new Set([
  "MEDIA_READ",
  "WEBM_PROBE",
  "WEBP_PROBE",
  "WEBP_DECODE",
  "MOTION_VERIFY",
  "POSTER_FIRST_FRAME",
]);

// Child-process errors can contain local paths and other private details. Keep
// diagnostics useful without forwarding the raw exception into Actions logs.
export function previewMediaFailureReason(stage, message) {
  const value = String(message || "");
  if (/^[A-Z0-9_]+$/.test(value) && value !== "MEDIA_DECODE_FAILED") return value;
  return SAFE_FAILURE_STAGES.has(stage) ? stage + "_FAILED" : "MEDIA_CHECK_FAILED";
}

export function hasWebmSignature(bytes) {
  return Boolean(bytes && bytes.length >= 4 &&
    bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3);
}

export function hasWebpSignature(bytes) {
  if (!bytes || bytes.length < 12) return false;
  const ascii = (start, end) => String.fromCharCode(...bytes.subarray(start, end));
  return ascii(0, 4) === "RIFF" && ascii(8, 12) === "WEBP";
}

export function selectedPreviewTiers(record, animation) {
  if (!record || typeof animation !== "string" || !animation ||
      record.defaultAnimation !== animation || record.webmStatus !== "ready" || record.previewStatus !== "ready") return null;
  const selected = record.allAnimationPreviews?.[animation];
  if (!selected || typeof selected !== "object") return null;
  const tiers = TIERS.map((tier) => ({
    ...tier,
    webmUrl: selected[tier.webmKey],
    posterUrl: selected[tier.posterKey],
  }));
  if (tiers.some((tier) => typeof tier.webmUrl !== "string" || !tier.webmUrl ||
      typeof tier.posterUrl !== "string" || !tier.posterUrl)) return null;
  if (record.webmPreview !== tiers[0].webmUrl || record.webpPoster !== tiers[0].posterUrl) return null;
  return tiers;
}

export function safePreviewDirectory(root, previewPath) {
  const relative = String(previewPath || "");
  if (!relative || relative.startsWith("/") || relative.includes("\\") ||
      relative.split("/").some((part) => !part || part === "." || part === "..")) return null;
  const rootPath = path.resolve(root);
  const target = path.resolve(rootPath, relative);
  return target.startsWith(rootPath + path.sep) ? target : null;
}

export function previewUrlMatches(value, previewPath, fileName) {
  try {
    const url = new URL(value);
    const expected = "/assets/" + String(previewPath).split("/").map(encodeURIComponent).join("/") +
      "/" + encodeURIComponent(fileName);
    return url.protocol === "https:" && url.hostname === "spine-link.vercel.app" &&
      decodeURIComponent(url.pathname) === decodeURIComponent(expected);
  } catch {
    return false;
  }
}

export function fingerprintPreviewMedia(entries) {
  const hash = createHash("sha256");
  for (const [name, bytes] of [...entries].sort((a, b) => String(a[0]).localeCompare(String(b[0])))) hash.update(String(name)).update(bytes);
  return hash.digest("hex");
}

const BLOCKED_RENDER_FAILURES = new Set([
  "COMPOSITED_FRAMES_IDENTICAL",
  "SELECTED_ANIMATION_HAS_NO_TIMELINES",
  "COMPOSITED_FRAMES_NOT_VISIBLE",
  "NO_VISIBLE_PIXEL",
  "POSTER_NO_VISIBLE_FRAMES",
  "DECODED_FRAMES_INVISIBLE",
  "RUNTIME_ALL_SKINS_INVISIBLE",
  "UNKNOWN_ANIMATION_DURATION",
  "SOURCE_GRAPH_MISSING",
  "ANIMATION_SELECTION",
]);

// Content-invalid selections stay blocked; infrastructure/encoder errors fail CI.
export function previewRenderDisposition(summary) {
  const failureCode = String(summary?.distinctError || "");
  return BLOCKED_RENDER_FAILURES.has(failureCode) ? "blocked" : "failed";
}
