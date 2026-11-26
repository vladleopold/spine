#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { frameDifferenceMetrics, generateFirstFrameWebp, verifyPosterFirstFrame } from './lib/first-frame-poster.mjs';

const exporter=fs.readFileSync(new URL('./spine-export-webm.mjs',import.meta.url),'utf8');
const repair=fs.readFileSync(new URL('./repair-latest-twenty-previews.mjs',import.meta.url),'utf8');
const helper=fs.readFileSync(new URL('./lib/first-frame-poster.mjs',import.meta.url),'utf8');
const recovery=fs.readFileSync(new URL('./recover-recorded-webm.mjs',import.meta.url),'utf8');

assert.match(exporter,/generateFirstFrameWebp\(source,\s*out\)/);
assert.doesNotMatch(exporter,/pickPosterFrame|frameHasContent|first frame was empty|using \${ss}s instead|webpOk/);
assert.match(helper,/-frames:v', '1'/);
assert.match(helper,/-pix_fmt', 'rgba'/);
assert.match(helper,/verifyPosterFirstFrame\(videoPath, posterPath\)/);
assert.match(helper,/frameDifferenceMetrics/);
assert.match(helper, /'-lossless', '0', '-quality', '88'/);
assert.match(helper, /meanDelta > 3\.5/);
assert.match(helper, /highDeltaRatio > 0\.025/);
const transparentPixelDifference=frameDifferenceMetrics(
  Buffer.from([255,0,0,0, 100,120,140,255]),
  Buffer.from([0,255,255,0, 105,115,145,255]),
);
assert.equal(transparentPixelDifference.maxDelta,10,
  'RGB differences under fully transparent pixels must not affect visual poster fidelity');
assert.ok(transparentPixelDifference.meanDelta < 4,
  'transparent RGB noise must not inflate average visual difference');

assert.doesNotMatch(helper,/-ss|positions|pickPosterFrame|scan real timeline/);
assert.match(repair,/generateFirstFrameWebp/);
assert.doesNotMatch(repair,/frames\/seconds>=15|f\/duration<15|18-39-06-745Z/);
assert.match(repair,/verify-preview-motion\.mjs/);
assert.match(recovery,/tierDimensions/);
assert.match(recovery,/Always encode from the same original capture/);
assert.doesNotMatch(recovery,/fs\.existsSync\(out\).*continue|RECOVERY_SOURCE_QUALITY/);
assert.match(recovery,/Wrong dimensions for recovered/);

const tempDir=fs.mkdtempSync(path.join(os.tmpdir(),'spine-first-frame-regression-'));
try{
  const input=path.join(tempDir,'synthetic-source.webm');
  const poster=path.join(tempDir,'synthetic-first-frame.webp');
  execFileSync('ffmpeg',[
    '-y','-v','error','-f','lavfi','-i','testsrc2=size=96x64:rate=6:duration=2',
    '-an','-c:v','libvpx-vp9','-pix_fmt','yuv420p','-deadline','realtime',
    '-cpu-used','8','-threads','2','-auto-alt-ref','0',input,
  ],{timeout:120000,stdio:['ignore','ignore','pipe']});
  const result=generateFirstFrameWebp(input,poster);
  assert.deepEqual([result.width,result.height],[96,64]);
  assert.ok(result.bytes>32);
  assert.deepEqual(verifyPosterFirstFrame(input,poster),result);
  const frameCount=Number(execFileSync('ffprobe',[
    '-v','error','-count_frames','-select_streams','v:0',
    '-show_entries','stream=nb_read_frames','-of','default=nw=1:nk=1',input,
  ],{encoding:'utf8',timeout:30000,stdio:['ignore','pipe','ignore']}).trim());
  assert.ok(frameCount>=8,'synthetic source must contain multiple real frames');
  console.log('PASS synthetic VP9 first-frame faithful compressed WebP regression; frames='+frameCount);
}finally{
  fs.rmSync(tempDir,{recursive:true,force:true});
}
