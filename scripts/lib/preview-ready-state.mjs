const blockedFields = [
  'previewBlockedAt',
  'previewBlockedAnimation',
  'previewBlockedSourceFingerprint',
  'previewBlockedSkin',
  'previewBlockedDistinctError',
  'previewBlockedRendererRevision',
  'lastPreviewRetryError',
];

export function acceptPreviewRender(record = {}, media = {}, timestamp = new Date().toISOString()) {
  const accepted = { ...record, ...media };

  for (const field of blockedFields) delete accepted[field];

  accepted.webmStatus = 'ready';
  accepted.previewStatus = 'ready';
  accepted.webmError = null;
  accepted.previewError = '';
  accepted.dispatchStatus = 'rendered';
  accepted.previewUpdatedAt = timestamp;

  return accepted;
}
