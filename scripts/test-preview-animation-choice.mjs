import assert from 'node:assert/strict';
import fs from 'node:fs';
import { choosePreviewAnimation } from './preview-animation-choice.mjs';

assert.equal(choosePreviewAnimation([
  'bkg_landscape', 'bkg_landscape_FG', 'blow_in_landscape',
  'blow_loop_landscape', 'popup_loop_landscape'
]), '', 'no index/CLI selection must not infer a loop or first animation');
assert.equal(choosePreviewAnimation(['background', 'Idle', 'Walk'], 'Walk'), 'Walk');
assert.equal(choosePreviewAnimation(['background', 'Idle', 'Walk'], 'Missing'), 'Missing');
assert.equal(choosePreviewAnimation(['mask', 'background']), '');
assert.equal(choosePreviewAnimation(['background', 'Walk'], 'mask'), 'mask');
assert.equal(choosePreviewAnimation(['background', 'Walk'], 'Missing'), 'Missing');
assert.equal(choosePreviewAnimation([]), '');
assert.equal(choosePreviewAnimation(['spine_play', 'Idle Post Climax Cum'],
  'Idle Post Climax Cum'), 'Idle Post Climax Cum');

const exporter = fs.readFileSync(new URL('./spine-export-webm.mjs', import.meta.url), 'utf8');
assert.doesNotMatch(exporter, /scenarioCycle|scenarioIdle|scenarioEntry|__spineScenario|\.addAnimation\(0/,
  'a preview must never sequence or substitute another animation');
assert.doesNotMatch(exporter, /window\.__animationNames\[0\]/,
  'an unavailable selected animation must not fall back to the first timeline');
assert.doesNotMatch(exporter, /runtimeSkins|skinCandidates\.push|readSkinNames/,
  'an invisible preview must not change source skins or layers');
assert.match(exporter, /const skinCandidates = \[null\]/,
  'capture must retain the source default skin only');
assert.match(exporter, /SELECTED_SPINE_ANIMATION_UNAVAILABLE/);
assert.match(exporter, /NO_SELECTED_SPINE_ANIMATION/);

assert.doesNotMatch(exporter, /choosePreviewAnimation\\(runtimeAnimations/,
  'runtime metadata must validate, never choose, a preview animation');

console.log('SPINE_PREVIEW_ANIMATION_SELECTION_TESTS_PASSED');
