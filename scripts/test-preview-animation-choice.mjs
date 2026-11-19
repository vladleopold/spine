import assert from 'node:assert/strict';
import { choosePreviewAnimation } from './preview-animation-choice.mjs';

assert.equal(choosePreviewAnimation(['bkg_landscape','blow_loop_landscape']), 'bkg_landscape');
assert.equal(choosePreviewAnimation(['background','Idle','Walk'], 'Walk'), 'Walk');
assert.equal(choosePreviewAnimation(['background','Idle','Walk'], 'Missing'), 'Missing');
assert.equal(choosePreviewAnimation(['mask','background']), 'mask');
assert.equal(choosePreviewAnimation([]), '');
assert.equal(choosePreviewAnimation(['spine_play','Idle Post Climax Cum'],
  'Idle Post Climax Cum'), 'Idle Post Climax Cum');
console.log('PASS Spine preview selects only the original requested/default animation; no substitutions');
