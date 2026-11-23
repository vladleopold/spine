import assert from 'node:assert/strict';
import { choosePreviewAnimation } from './preview-animation-choice.mjs';

assert.equal(choosePreviewAnimation(['bkg_landscape','blow_loop_landscape']), 'bkg_landscape',
  'when no default exists, select a deterministic source track');
assert.equal(choosePreviewAnimation(['background','Idle','Walk']), 'Idle',
  'prefer an exact Idle track');
assert.equal(choosePreviewAnimation(['walk','Idle Post Climax Cum']), 'Idle Post Climax Cum',
  'prefer a named idle variant');
assert.equal(choosePreviewAnimation(['background','Walk'], 'Walk'), 'Walk',
  'preserve explicit selection');
assert.equal(choosePreviewAnimation(['background','Idle','Walk'], 'Missing'), 'Missing',
  'an unavailable explicit name remains unchanged for a failed/blocked result');
assert.equal(choosePreviewAnimation(['mask','background']), 'mask',
  'preserve deterministic source order when no idle exists');
assert.equal(choosePreviewAnimation([]), '');
assert.equal(choosePreviewAnimation(['walk'], ' walk '), ' walk ',
  'preserve the requested animation string exactly');
console.log('PASS Spine preview preserves explicit selection and deterministically selects a source track when absent');
