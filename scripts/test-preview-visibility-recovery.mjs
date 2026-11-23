import assert from 'node:assert/strict';
import fs from 'node:fs';
import {hasVisibleScreenshotPixels} from './lib/preview-visibility-recovery.mjs';
import {choosePreviewAnimation} from './preview-animation-choice.mjs';
assert.equal(choosePreviewAnimation(['idle', 'run'], 'nonexistent'), 'nonexistent');
assert.equal(choosePreviewAnimation(['idle', 'run'], 'idle'), 'idle');
assert.equal(choosePreviewAnimation(['idle', 'run'], ''), 'idle',
  'missing index/default selection prefers a declared Idle source track');
const source=fs.readFileSync(new URL('./spine-export-webm.mjs',import.meta.url),'utf8');
assert.doesNotMatch(source,/alternatePreviewAnimations|targetAnimation\s*=\s*candidate|SPINE_VISIBLE_ALTERNATE_ANIMATION/);
assert.doesNotMatch(source,/__animationNames\s*\[\s*0\s*\]/,
  'never choose the first runtime animation when the selected name is empty');
assert.match(source,/window\.__selectedAnimation = \$\{JSON\.stringify\(captureAnimation\)\};/);
assert.match(source,/const skinCandidates = Object\.freeze\(\[null,\.\.\.readSkinNames\(skeletonFilePath\)\]\);/,
  'try the original default skin first, then only skins declared by the same source skeleton');
assert.match(source,/if \(framePeak < FRAME_PEAK_MIN\) \{[\s\S]*?continue;/,
  'an invisible default skin advances to the next source-declared skin without editing source files');
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
const darkArtwork=Buffer.alloc(32*32*3,7);
for(let i=100;i<108;i++)darkArtwork.fill(24,i*3,i*3+3);
assert.equal(hasVisibleScreenshotPixels(darkArtwork),true,
  'dark artwork with real contrast against the dark canvas must not be rejected');
const nearUniform=Buffer.alloc(32*32*3,7);
for(let i=100;i<120;i++)nearUniform[i*3]=16;
assert.equal(hasVisibleScreenshotPixels(nearUniform),false,
  'minor pixel noise must not make a blank canvas visible');
console.log('PASS Spine preview: deterministic source animation/skin recovery; contrast-based real-pixel detection');
