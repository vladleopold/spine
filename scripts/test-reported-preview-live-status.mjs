import assert from 'node:assert/strict';
import { reconcileReportedPreviewLiveStatus } from './lib/reported-preview-live-status.mjs';

const pending = {
  webmStatus: 'pending-live',
  previewStatus: 'pending',
  defaultAnimation: 'Walk',
  animations: ['Walk', 'Run'],
};
assert.equal(reconcileReportedPreviewLiveStatus(pending, { ok: true, mediaVerified: 6 }, '2026-11-21T00:00:00.000Z'), 'ready');
assert.equal(pending.webmStatus, 'ready');
assert.equal(pending.previewStatus, 'ready');
assert.equal(pending.previewLiveMediaVerifiedCount, 6);
assert.equal(pending.defaultAnimation, 'Walk');
assert.deepEqual(pending.animations, ['Walk', 'Run']);

const unavailable = { webmStatus: 'pending-live', previewStatus: 'pending', defaultAnimation: 'Missing' };
assert.equal(reconcileReportedPreviewLiveStatus(unavailable, { ok: false, mediaVerified: 0, code: 'HTTP_402' }), 'failed');
assert.equal(unavailable.webmStatus, 'failed');
assert.equal(unavailable.previewStatus, 'failed');
assert.equal(unavailable.previewError, 'HTTP_402');
assert.equal(unavailable.defaultAnimation, 'Missing');

const blocked = { webmStatus: 'blocked-missing-animation', previewStatus: 'blocked', defaultAnimation: '' };
assert.equal(reconcileReportedPreviewLiveStatus(blocked, { ok: true, mediaVerified: 6 }), 'blocked');
assert.equal(blocked.webmStatus, 'blocked-missing-animation');

const renderFailed = { webmStatus: 'failed', previewStatus: 'failed', defaultAnimation: 'Walk' };
assert.equal(reconcileReportedPreviewLiveStatus(renderFailed, { ok: true, mediaVerified: 6 }), 'failed');
assert.equal(renderFailed.webmStatus, 'failed');

console.log('PASS reported live status: only six verified production assets can become ready; blocked/failed and animation metadata stay unchanged');
