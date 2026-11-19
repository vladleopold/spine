import assert from 'node:assert/strict';
import fs from 'node:fs';
import { exactPreviewAnimation } from './lib/preview-index-preservation.mjs';

const record = {
  defaultAnimation: 'selected-animation',
  animations: ['selected-animation', 'other-animation'],
};
const original = JSON.stringify(record);
assert.deepEqual(
  exactPreviewAnimation({ animation: 'selected-animation' }, record, { animation: 'selected-animation' }),
  { ok: true, animation: 'selected-animation' },
);
assert.deepEqual(
  exactPreviewAnimation({ animation: 'missing-animation' }, record, { animation: 'selected-animation' }),
  { ok: false, animation: 'missing-animation', reason: 'rendered-animation-mismatch' },
);
assert.deepEqual(
  exactPreviewAnimation({}, { defaultAnimation: 'selected-animation' }, { animation: 'other-animation' }),
  { ok: false, animation: 'selected-animation', reason: 'rendered-animation-mismatch' },
);
assert.deepEqual(
  exactPreviewAnimation({}, { animations: ['selected-animation'] }, { animation: 'selected-animation' }),
  { ok: false, animation: '', reason: 'missing-index-selection' },
);
assert.equal(JSON.stringify(record), original, 'preview validation must not mutate source animation metadata');

const repair = fs.readFileSync(new URL('./repair-reported-previews.mjs', import.meta.url), 'utf8');
assert.match(repair, /exactPreviewAnimation\(item,record,meta\)/);
assert.doesNotMatch(repair, /record\.animations\s*=/, 'repair must not rewrite the source animation list');
assert.doesNotMatch(repair, /record\.defaultAnimation\s*=/, 'repair must not rewrite the selected animation name');
console.log('SPINE_PREVIEW_INDEX_SOURCE_PRESERVATION_TESTS_PASSED');
