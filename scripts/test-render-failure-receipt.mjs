import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { createRenderFailureReceipt, writeRenderFailureReceipt } from './lib/render-failure-receipt.mjs';

const blocked = createRenderFailureReceipt('selection', new Error('SELECTED_SPINE_ANIMATION_NOT_SPECIFIED'), [
  { type: 'webm', codec: 'vp9', width: 960, height: 720, frames: 8, duration: 1.2, path: '/private/source/name.skel' },
]);
assert.deepEqual(blocked, {
  status: 'blocked', stage: 'selection', code: 'SELECTED_SPINE_ANIMATION_NOT_SPECIFIED',
  formats: [{ type: 'webm', codec: 'vp9', width: 960, height: 720, frames: 8, duration: 1.2 }],
});
assert.equal(createRenderFailureReceipt('render', new Error('SPINE_LEGACY_RUNTIME_UNAVAILABLE_2_1')).status, 'blocked');
assert.equal(createRenderFailureReceipt('render', new Error('ffmpeg failed')).status, 'failed');
assert.doesNotMatch(JSON.stringify(blocked), /private|source|name\.skel/);

const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'spine-receipt-test-'));
try {
  const file = path.join(dir, 'render-verification.json');
  const written = writeRenderFailureReceipt(file, 'initial-render', new Error('SPINE_LEGACY_RUNTIME_UNAVAILABLE_2_1'));
  assert.equal(JSON.parse(fs.readFileSync(file, 'utf8')).code, written.code);
} finally {
  fs.rmSync(dir, { recursive: true, force: true });
}
console.log('SANITIZED_RENDER_FAILURE_RECEIPT_TESTS_PASSED');
