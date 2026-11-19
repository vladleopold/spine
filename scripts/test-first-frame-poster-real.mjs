#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { generateFirstFrameWebp, verifyPosterFirstFrame } from './lib/first-frame-poster.mjs';

const root=fs.mkdtempSync(path.join(os.tmpdir(),'spine-first-frame-'));
const run=(args,options={})=>execFileSync('ffmpeg',['-y','-v','error',...args],{
  timeout:120000,maxBuffer:32*1024*1024,stdio:['ignore','pipe','pipe'],...options
});
const rawFrame=(video,frame)=>{
  const args=['-v','error','-i',video];
  if(frame!==0)args.push('-vf',`select=eq(n\\,${frame})`,'-vsync','0');
  args.push('-map','0:v:0','-frames:v','1','-pix_fmt','rgba','-f','rawvideo','pipe:1');
  return execFileSync('ffmpeg',args,{timeout:120000,maxBuffer:8*1024*1024,stdio:['ignore','pipe','ignore']});
};
try{
  const high=path.join(root,'preview.webm');
  run([
    '-f','lavfi','-i','color=c=red:s=96x64:r=10:d=0.5',
    '-f','lavfi','-i','color=c=blue:s=96x64:r=10:d=0.5',
    '-filter_complex','[0:v][1:v]concat=n=2:v=1:a=0,format=yuv420p[v]',
    '-map','[v]','-frames:v','10','-c:v','libvpx-vp9','-lossless','1',
    '-deadline','realtime','-cpu-used','8',high
  ]);
  const first=rawFrame(high,0),later=rawFrame(high,7);
  assert.ok(first.length>0&&later.length===first.length);
  assert.notDeepEqual(first,later,'fixture must contain a visibly different later frame');

  const tiers=[
    {name:'high',video:high,width:96,height:64},
    {name:'medium',video:path.join(root,'preview-medium.webm'),width:64,height:42},
    {name:'low',video:path.join(root,'preview-low.webm'),width:32,height:22},
  ];
  for(const tier of tiers.slice(1)){
    run(['-i',high,'-vf',`scale=${tier.width}:${tier.height}`,
      '-c:v','libvpx-vp9','-lossless','1','-deadline','realtime','-cpu-used','8',tier.video]);
  }
  for(const tier of tiers){
    const poster=tier.video.replace(/\\.webm$/i,'.webp');
    const result=generateFirstFrameWebp(tier.video,poster);
    assert.equal(result.width,tier.width);
    assert.equal(result.height,tier.height);
    assert.ok(fs.statSync(poster).size>32);
    const magic=fs.readFileSync(poster).subarray(0,12);
    assert.equal(magic.subarray(0,4).toString('ascii'),'RIFF');
    assert.equal(magic.subarray(8,12).toString('ascii'),'WEBP');
    assert.deepEqual(rawFrame(tier.video,0),rawFrame(poster,0),
      tier.name+' WebP must be the exact decoded first frame of its own WebM');
    assert.deepEqual(verifyPosterFirstFrame(tier.video,poster).width,tier.width);
  }
  assert.notDeepEqual(rawFrame(high,0),rawFrame(high,7),
    'poster extraction must not substitute a later visible frame for frame zero');
  console.log('PASS real WebM/WebP frame-zero pairing: high, medium and low; later frame is rejected');
}finally{
  fs.rmSync(root,{recursive:true,force:true});
}
