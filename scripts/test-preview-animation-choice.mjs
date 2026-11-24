import assert from 'node:assert/strict';
import { choosePreviewAnimation, resolvePreviewAnimation } from './preview-animation-choice.mjs';

assert.equal(choosePreviewAnimation(['bkg_landscape','blow_loop_landscape']), 'bkg_landscape',
  'choose a deterministic source track when no default exists');
assert.equal(choosePreviewAnimation(['background','Idle','Walk']), 'Idle',
  'prefer an exact Idle track');
assert.equal(choosePreviewAnimation(['walk','Idle Post Climax Cum']), 'Idle Post Climax Cum',
  'prefer a named idle variant');
assert.equal(choosePreviewAnimation(['background','Walk'], 'Walk'), 'Walk',
  'preserve an explicit selection when it is animated');
assert.equal(choosePreviewAnimation(['Idle','Walk'], 'Missing'), 'Missing',
  'preserve an explicit string verbatim; renderer callers decide when it is unavailable');
assert.equal(choosePreviewAnimation(['Idle','Walk'], 'background'), 'background',
  'preserve an explicit static string verbatim; renderer callers select a moving fallback');
assert.equal(choosePreviewAnimation([], 'Missing'), 'Missing',
  'preserve exact selection when binary source track names are not locally inspectable');
assert.equal(resolvePreviewAnimation(['Idle','Walk'], 'Idle', true), 'Idle',
  'preserve an available explicit animation during recovery');
assert.equal(resolvePreviewAnimation(['Walk','Run'], 'Missing', true), 'Walk',
  'recover a stale animation pointer using a real source track only when opted in');
assert.equal(resolvePreviewAnimation(['Walk','Run'], 'Missing', false), 'Missing',
  'do not silently change explicit selections outside recovery mode');
assert.equal(resolvePreviewAnimation(['Walk','Run'], '', false), 'Walk',
  'choose a source track when the upload has no explicit animation');
assert.equal(choosePreviewAnimation(['mask','background']), 'mask',
  'preserve source order when no idle exists');
assert.equal(choosePreviewAnimation([]), '');
assert.equal(choosePreviewAnimation(['walk'], ' walk '), ' walk ',
  'preserve the requested animation string exactly');
console.log('PASS Spine preview preserves valid explicit selections and selects moving source tracks when needed');
