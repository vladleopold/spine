import assert from 'node:assert/strict';
import { choosePreviewAnimation } from './preview-animation-choice.mjs';

assert.equal(choosePreviewAnimation(['bkg_landscape','blow_loop_landscape']), '',
  'without an explicit/indexed selection, do not guess the first animation');
assert.equal(choosePreviewAnimation(['background','Idle','Walk'], 'Walk'), 'Walk');
assert.equal(choosePreviewAnimation(['background','Idle','Walk'], 'Missing'), 'Missing',
  'an unavailable requested name remains unchanged for a failed/blocked result');
assert.equal(choosePreviewAnimation(['mask','background']), '',
  'a mask or first track must never become an implicit preview');
assert.equal(choosePreviewAnimation([]), '');
assert.equal(choosePreviewAnimation(['spine_play','Idle Post Climax Cum'],
  'Idle Post Climax Cum'), 'Idle Post Climax Cum');
assert.equal(choosePreviewAnimation(['walk'], ' walk '), ' walk ',
  'preserve the requested animation string exactly');
console.log('PASS Spine preview selects only the original requested/default animation; no substitutions');
