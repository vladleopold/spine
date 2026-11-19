import assert from 'node:assert/strict';
import { choosePreviewAnimation } from './preview-animation-choice.mjs';

assert.equal(choosePreviewAnimation([
  'bkg_landscape', 'bkg_landscape_FG', 'blow_in_landscape',
  'blow_loop_landscape', 'popup_loop_landscape'
]), 'blow_loop_landscape');
assert.equal(choosePreviewAnimation(['background', 'Idle', 'Walk'], 'Walk'), 'Walk');
assert.equal(choosePreviewAnimation(['background', 'Idle', 'Walk'], 'Missing'), 'Missing');
assert.equal(choosePreviewAnimation(['mask', 'background']), 'mask');
assert.equal(choosePreviewAnimation([]), '');
assert.equal(choosePreviewAnimation(['spine_play', 'Idle Post Climax Cum'],
  'Idle Post Climax Cum'), 'Idle Post Climax Cum');
console.log('SPINE_PREVIEW_ANIMATION_SELECTION_TESTS_PASSED');
