import { createHash } from 'node:crypto';
export const REQUIRED_EXPORT_PREVIEW_FILES = Object.freeze([
  'preview.webm', 'preview-medium.webm', 'preview-low.webm',
  'preview.webp', 'preview-medium.webp', 'preview-low.webp',
]);
const TIERS = Object.freeze([
  { name: 'preview.webm', key: 'webmHigh', kind: 'webm' },
  { name: 'preview-medium.webm', key: 'webmMedium', kind: 'webm' },
  { name: 'preview-low.webm', key: 'webmLow', kind: 'webm' },
  { name: 'preview.webp', key: 'webpHigh', kind: 'webp' },
  { name: 'preview-medium.webp', key: 'webpMedium', kind: 'webp' },
  { name: 'preview-low.webp', key: 'webpLow', kind: 'webp' },
]);
const ROOT_FIELDS = Object.freeze([
  'webmPreview', 'webmPreviewMedium', 'webmPreviewLow', 'webpPoster', 'webpPosterMedium', 'webpPosterLow',
  'webmPreviewPath', 'webmGeneratedAt', 'previewDuration', 'previewWidth', 'previewHeight',
  'webmChunksJson', 'webmChunks', 'webmChunkCount', 'webmIsChunked',
]);
export function resolveIndexedExportAnimation(entry) {
  const animation = typeof entry?.defaultAnimation === 'string' ? entry.defaultAnimation : '';
  if (!animation) return { status: 'blocked', reason: 'MISSING_DEFAULT_ANIMATION' };
  if (!Array.isArray(entry?.animations) || !entry.animations.includes(animation)) {
    return { status: 'blocked', reason: 'DEFAULT_ANIMATION_NOT_IN_SOURCE' };
  }
  return { status: 'ready', animation };
}
export function blockDefaultPreview(entry, reason) {
  const code = /^[A-Z0-9_]+$/.test(String(reason || '')) ? String(reason) : 'PREVIEW_BLOCKED';
  const next = { ...(entry || {}), webmStatus: 'blocked', previewStatus: 'blocked', webmError: code, previewError: code };
  for (const key of ROOT_FIELDS) delete next[key];
  return next;
}
function getBytes(files, name) {
  if (files instanceof Map) return files.get(name);
  return files && Object.prototype.hasOwnProperty.call(files, name) ? files[name] : undefined;
}
function hasWebmSignature(bytes) {
  return Buffer.isBuffer(bytes) && bytes.length >= 4 && bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3;
}
function hasWebpSignature(bytes) {
  return Buffer.isBuffer(bytes) && bytes.length >= 12 && bytes.toString('ascii', 0, 4) === 'RIFF' && bytes.toString('ascii', 8, 12) === 'WEBP';
}
export function validateExportPreviewArtifact(entry, meta, files) {
  const selection = resolveIndexedExportAnimation(entry);
  if (selection.status !== 'ready') return { ok: false, reason: selection.reason };
  if (!meta || typeof meta !== 'object' || Array.isArray(meta)) return { ok: false, reason: 'MISSING_EXPORT_METADATA' };
  if (meta.animation !== selection.animation) return { ok: false, reason: 'SELECTED_ANIMATION_MISMATCH' };
  if (!Array.isArray(meta.animations) || !meta.animations.includes(selection.animation)) return { ok: false, reason: 'SELECTED_ANIMATION_NOT_IN_SOURCE' };
  if (meta.alpha !== false) return { ok: false, reason: 'UNEXPECTED_ALPHA_EXPORT' };
  if (!(Number(meta.animationDuration) > 0) || !(Number(meta.width) > 0) || !(Number(meta.height) > 0)) return { ok: false, reason: 'INCOMPLETE_EXPORT_METADATA' };
  const widths = meta.qualityWidths;
  if (!widths || !['high', 'medium', 'low'].every((key) => Number(widths[key]) > 0)) return { ok: false, reason: 'INCOMPLETE_QUALITY_METADATA' };
  if (!meta.files || typeof meta.files !== 'object') return { ok: false, reason: 'MISSING_TIER_METADATA' };
  for (const tier of TIERS) {
    const bytes = getBytes(files, tier.name);
    if (!Buffer.isBuffer(bytes) || bytes.length === 0) return { ok: false, reason: 'MISSING_' + tier.key.toUpperCase() };
    const valid = tier.kind === 'webm' ? hasWebmSignature(bytes) : hasWebpSignature(bytes);
    if (!valid) return { ok: false, reason: 'INVALID_' + tier.key.toUpperCase() };
    if (Number(meta.files[tier.key]) !== bytes.length) return { ok: false, reason: 'SIZE_MISMATCH_' + tier.key.toUpperCase() };
  }
  const high = getBytes(files, 'preview.webm');
  const digest = createHash('sha256').update(high).digest('hex');
  if (Number(meta.bytes) !== high.length || String(meta.sha256 || '').toLowerCase() !== digest) return { ok: false, reason: 'WEBM_FINGERPRINT_MISMATCH' };
  return { ok: true, animation: selection.animation };
}