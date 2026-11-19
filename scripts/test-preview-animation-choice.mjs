import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { choosePreviewAnimation } from './preview-animation-choice.mjs';

assert.equal(choosePreviewAnimation(['background', 'Idle', 'Walk']), '');
assert.equal(choosePreviewAnimation(['mask', 'background']), '');
assert.equal(choosePreviewAnimation([]), '');
assert.equal(choosePreviewAnimation(['background', 'Idle', 'Walk'], 'Walk'), 'Walk');
assert.equal(choosePreviewAnimation(['background', 'Idle', 'Walk'], 'Missing'), 'Missing');
assert.equal(choosePreviewAnimation(['mask', 'background'], 'Selected Test Animation'), 'Selected Test Animation');

const renderer = readFileSync(new URL('./spine-export-webm.mjs', import.meta.url), 'utf8');
assert.ok(renderer.includes('SELECTED_SPINE_ANIMATION_NOT_SPECIFIED'));
assert.ok(renderer.includes('SELECTED_SPINE_ANIMATION_UNAVAILABLE'));
assert.ok(renderer.includes('SPINE_LEGACY_RUNTIME_UNAVAILABLE'));
assert.ok(renderer.includes('const scenarioCycle = [];'));
assert.ok(!renderer.includes('scenarioEntry') && !renderer.includes('scenarioExit') && !renderer.includes('scenarioIdle'));
assert.ok(!renderer.includes('window.__animationNames[0]'));
assert.ok(renderer.includes('window.__selectedAnimation = ${JSON.stringify(captureAnimation)};'));
assert.ok(renderer.includes('window.__animationNames.includes(window.__selectedAnimation)'));
console.log('SPINE_PREVIEW_SELECTION_NO_SUBSTITUTION_TESTS_PASSED');
