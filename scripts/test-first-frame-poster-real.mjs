#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { generateFirstFrameWebp, verifyPosterFirstFrame } from './lib/first-frame-poster.mjs';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'spine-first-frame-'));
const run=(args)=>execFileSync('ffmpeg',['-y','-v','error',...args],{timeout:120000,maxBuffer:32*1024*1024,stdio:['ignore','pipe','pipe']});
try{
  const high=path.join(root,'preview.webm');
  run(['-f','lavfi','-i','color=c=red:s=96x64:r=10:d=0.5','-f','lavfi','-i','color=c=blue:s=96x64:r=10:d=0.5','-filter_complex','[0:v][1:v]concat=n=2:v=1:a=0,format=yuv420p[v]','-map','[v]','-frames:v','10','-c:v','libvpx-vp9','-lossless','1','-deadline','realtime','-cpu-used','8',high]);
  const tiers=[{name:'high',video:high,width:96,height:64},{name:'medium',video:path.join(root,'preview-medium.webm'),width:64,height:42},{name:'low',video:path.join(root,'preview-low.webm'),width:32,height:22}];
  for(const tier of tiers.slice(1))run(['-i',high,'-vf','scale='+tier.width+':'+tier.height,'-c:v','libvpx-vp9','-lossless','1','-deadline','realtime','-cpu-used','8',tier.video]);
  for(const tier of tiers){const poster=tier.video.replace(/\.webm$/i,'.webp');const result=generateFirstFrameWebp(tier.video,poster);assert.equal(result.width,tier.width);assert.equal(result.height,tier.height);assert.ok(fs.statSync(poster).size>32);const magic=fs.readFileSync(poster).subarray(0,12);assert.equal(magic.subarray(0,4).toString('ascii'),'RIFF');assert.equal(magic.subarray(8,12).toString('ascii'),'WEBP');assert.deepEqual(verifyPosterFirstFrame(tier.video,poster).width,tier.width);}
  const laterPoster=path.join(root,'later-frame.webp');run(['-i',high,'-vf','select=eq(n\\,7)','-vsync','0','-frames:v','1','-c:v','libwebp','-lossless','1','-quality','100',laterPoster]);
  assert.throws(()=>verifyPosterFirstFrame(high,laterPoster),/not a faithful first frame/,'a later frame must never be accepted as the first-frame poster');
  console.log('PASS real WebM/WebP frame-zero pairing: high, medium and low; later frame is rejected');
}finally{fs.rmSync(root,{recursive:true,force:true});}
