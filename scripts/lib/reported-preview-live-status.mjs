export function reconcileReportedPreviewLiveStatus(record, result, verifiedAt = new Date().toISOString()) {
  if (!record || typeof record !== 'object') throw new TypeError('A preview record is required');
  const current = String(record.webmStatus || '');
  if (current === 'blocked' || current.startsWith('blocked-')) return 'blocked';
  if (current !== 'ready' && current !== 'pending-live') return current || 'pending';
  const passed = result?.ok === true && Number(result?.mediaVerified) === 6;
  record.previewLiveVerifiedAt = verifiedAt;
  record.previewLiveMediaVerifiedCount = Number(result?.mediaVerified || 0);
  if (passed) {
    record.webmStatus = 'ready';
    record.previewStatus = 'ready';
    record.previewError = '';
    return 'ready';
  }
  const code = String(result?.code || 'LIVE_MEDIA_VERIFICATION_FAILED');
  record.webmStatus = 'failed';
  record.previewStatus = 'failed';
  record.previewError = code.replace(/[^A-Z0-9_-]/g, '_').slice(0, 80);
  return 'failed';
}
