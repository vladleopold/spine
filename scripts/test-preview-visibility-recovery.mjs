import assert from 'node:assert/strict';
import fs from 'node:fs';
import {hasVisibleScreenshotPixels} from './lib/preview-visibility-recovery.mjs';
import {choosePreviewAnimation} from './preview-animation-choice.mjs';

assert.equal(choosePreviewAnimation(['idle','run'],'Exact Track'),'Exact Track');
assert.equal(choosePreviewAnimation(['Idle','Walk'],'Idle'),'Idle');
assert.equal(choosePreviewAnimation(['idle','run'],''),'', 'empty selection remains blocked');
const source=fs.readFileSync(new URL('./spine-export-webm.mjs',import.meta.url),'utf8');
assert.ok(source.includes('const skinCandidates = [null];'));
assert.ok(source.includes('window.__selectedAnimation = ${JSON.stringify(captureAnimation)};'));
assert.ok(source.includes('const pinnedAnimation = targetAnimation;'));
assert.ok(source.includes('SAME_ANIMATION_VISIBILITY_PROBES='));
assert.ok(source.includes('CANVAS_FALLBACK_CAPTURE=started'));
for(const token of ['skinCandidates.push','SOURCE_SKIN_FALLBACK','allowVisibleTrackFallback',
  '--allow-visible-track-fallback','alternatePreviewAnimations','targetAnimation = candidate','__SPINE_AUTO__'])
  assert.ok(!source.includes(token), 'unexpected fallback token: '+token);

const blank=Buffer.alloc(32*32*3,7);
assert.equal(hasVisibleScreenshotPixels(blank),false);
for(let i=0;i<7;i++)blank[i*3]=255;
assert.equal(hasVisibleScreenshotPixels(blank),false);
blank[7*3]=255;
assert.equal(hasVisibleScreenshotPixels(blank),true);
const darkArtwork=Buffer.alloc(32*32*3,7);
for(let i=100;i<108;i++)darkArtwork.fill(24,i*3,i*3+3);
assert.equal(hasVisibleScreenshotPixels(darkArtwork),true);
const nearUniform=Buffer.alloc(32*32*3,7);
for(let i=100;i<120;i++)nearUniform[i*3]=16;
assert.equal(hasVisibleScreenshotPixels(nearUniform),false);
console.log('PASS same-animation visibility/canvas recovery without track or skin substitution');
