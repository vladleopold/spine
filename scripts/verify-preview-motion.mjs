#!/usr/bin/env node
// Require at least eight decoded, visibly nonzero, mutually distinct frames.
// Preserve RGB: grayscale conversion can collapse genuine color-only animation.
import {execFileSync} from 'node:child_process';
import {hasVisibleRgbContent} from './lib/preview-frame-content.mjs';
import {createHash} from 'node:crypto';
const file=process.argv[2];
if(!file)throw Error('Missing preview candidate');
const width=48,height=48,channels=3,frameBytes=width*height*channels;
const raw=execFileSync('ffmpeg',[
  '-v','error','-i',file,'-map','0:v:0',
  '-vf','scale='+width+':'+height+',format=rgb24',
  '-frames:v','180','-f','rawvideo','-pix_fmt','rgb24','-'
],{timeout:120000,maxBuffer:2*1024*1024});
if(raw.length%frameBytes)throw Error('Decoded preview has an incomplete frame');
const decoded=raw.length/frameBytes;
const distinct=new Set();let nonzero=0;
for(let offset=0;offset+frameBytes<=raw.length;offset+=frameBytes){
  const frame=raw.subarray(offset,offset+frameBytes);
  if(hasVisibleRgbContent(frame)){
    nonzero++;
    distinct.add(createHash('sha256').update(frame).digest('hex'));
  }
}
if(decoded<8||nonzero<8||distinct.size<8){
  console.error('PREVIEW_MOTION_REJECTED '+JSON.stringify({decoded,nonzero,distinct:distinct.size}));
  process.exit(1);
}
console.log('PREVIEW_MOTION_ACCEPTED '+JSON.stringify({decoded,nonzero,distinct:distinct.size}));
