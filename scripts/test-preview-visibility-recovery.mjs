import assert from 'node:assert/strict';
import fs from 'node:fs';
import {hasVisibleScreenshotPixels} from './lib/preview-visibility-recovery.mjs';
import {choosePreviewAnimation} from './preview-animation-choice.mjs';
assert.equal(choosePreviewAnimation(['idle', 'run'], 'nonexistent'), 'nonexistent');
assert.equal(choosePreviewAnimation(['idle', 'run'], 'idle'), 'idle');
assert.equal(choosePreviewAnimation(['idle', 'run'], ''), 'idle',
  'missing index/default selection prefers a declared Idle source track');
const source=fs.readFileSync(new URL('./spine-export-webm.mjs',import.meta.url),'utf8');
assert.match(source,/if \(args\.allowVisibleTrackFallback\)[\s\S]*?const candidates = \[targetAnimation, \.\.\.alternatives\.slice\(0, 7\)\]/,
  'source-declared alternatives are considered only in the explicit repair mode');
assert.match(source,/candidatePeak >= FRAME_PEAK_MIN && changing[\s\S]*?targetAnimation = candidate/,
  'the preview may change tracks only after a candidate shows visible changing pixels');
assert.match(source,/window\.__selectedAnimation = \$\{JSON\.stringify\(captureAnimation\)\} \|\|[\s\S]*?window\.__animationNames\.find\(function\(name\) \{ return \/\^idle\$\/i\.test\(name\); \}\)/,
  'binary-only sources prefer a runtime Idle track before the first declared track');
assert.match(source,/const skinCandidates = \[null,\.\.\.readSkinNames\(skeletonFilePath\)\];/,
  'try the original default skin first, then JSON-declared source skins');
assert.match(source,/window\.__skinNames = Array\.isArray\(runtimeSkins\)/,
  'binary-only sources expose skin names from the loaded runtime');
assert.match(source,/if \(skinIndex === 0 && skinCandidates\.length === 1\)[\s\S]*?skinCandidates\.push\(name\)/,
  'when the default is invisible, try runtime-discovered skins from the same skeleton');
assert.match(source,/if \(framePeak < FRAME_PEAK_MIN\) \{[\s\S]*?continue;/,
  'an invisible default skin advances to the next source-declared or runtime-discovered skin without editing source files');
assert.match(source,/SELECTED_SPINE_ANIMATION_UNAVAILABLE/);
assert.match(source,/NO_DEFAULT_SPINE_ANIMATION/);
assert.ok(source.includes("const requestedAnimation = args.animation !== '' ? args.animation : indexedAnimation"));
assert.ok(source.includes("if (!pinnedAnimation || !runtimeAnimations.includes(pinnedAnimation))"));
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
console.log('PASS Spine preview: deterministic source animation/skin recovery, including binary runtime fallback; contrast-based real-pixel detection');
