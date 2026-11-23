import assert from 'node:assert/strict';
import { choosePreviewAnimation } from './preview-animation-choice.mjs';

assert.equal(choosePreviewAnimation(['Idle','Walk'], 'Idle'), 'Idle');
assert.equal(choosePreviewAnimation(['Idle','Walk'], 'Exact Selected Track'), 'Exact Selected Track',
  'preserve the exact selected value even when it is not in a local source-name list');
assert.equal(choosePreviewAnimation(['Idle','Walk'], ' Walk '), ' Walk ',
  'do not trim or normalize an explicitly selected name');
assert.equal(choosePreviewAnimation(['Idle','Walk'], ''), '',
  'an empty selection must never infer Idle');
assert.equal(choosePreviewAnimation(['Walk']), '',
  'a non-empty source track list is not an explicit animation selection');
assert.equal(choosePreviewAnimation(['background','Idle','Walk']), '',
  'do not choose Idle from source track order');
assert.equal(choosePreviewAnimation([]), '');
console.log('PASS animation selection requires an exact explicit name; no list-order fallback');
