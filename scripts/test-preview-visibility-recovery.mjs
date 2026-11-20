import assert from 'node:assert/strict';
import fs from 'node:fs';
import {hasVisibleScreenshotPixels} from './lib/preview-visibility-recovery.mjs';
import {choosePreviewAnimation} from './preview-animation-choice.mjs';
assert.equal(choosePreviewAnimation(['idle', 'run'], 'nonexistent'), 'nonexistent');
assert.equal(choosePreviewAnimation(['idle', 'run'], 'idle'), 'idle');
assert.equal(choosePreviewAnimation(['idle', 'run'], ''), '',
  'missing index/default selection must not resolve to the first runtime animation');
const source=fs.readFileSync(new URL('./spine-export-webm.mjs',import.meta.url),'utf8');
assert.doesNotMatch(source,/alternatePreviewAnimations|targetAnimation\s*=\s*candidate|SPINE_VISIBLE_ALTERNATE_ANIMATION/);
assert.doesNotMatch(source,/__animationNames\s*\[\s*0\s*\]/,
  'never choose the first runtime animation when the selected name is empty');
assert.match(source,/window\.__selectedAnimation = \$\{JSON\.stringify\(captureAnimation\)\};/);
assert.match(source,/const skinCandidates = Object\.freeze\(\[null\]\);/,
  'render only the source default skin; do not switch to another skin');
assert.doesNotMatch(source,/skinCandidates\.push|runtimeSkins|readSkinNames|skinNames\.filter/,
  'do not substitute alternate source skins or layers');
assert.match(source,/SELECTED_SPINE_ANIMATION_UNAVAILABLE/);
assert.match(source,/NO_DEFAULT_SPINE_ANIMATION/);
assert.ok(source.includes("const requestedAnimation = args.animation !== '' ? args.animation : indexedAnimation"));
assert.ok(source.includes("if (!runtimeAnimations.includes(pinnedAnimation))"));
assert.ok(!source.includes("if (!targetAnimation) targetAnimation ="));
assert.ok(!source.includes("targetAnimation = await page.evaluate"));
const blank=Buffer.alloc(32*32*3,7);
assert.equal(hasVisibleScreenshotPixels(blank),false);
for(let i=0;i<7;i++)blank[i*3]=255;
assert.equal(hasVisibleScreenshotPixels(blank),false);
blank[7*3]=255;
assert.equal(hasVisibleScreenshotPixels(blank),true);
console.log('PASS Spine preview: no animation substitution; exact selection and real composited pixels');
