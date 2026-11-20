#!/usr/bin/env node
// Require at least eight decoded, visibly nonzero, mutually distinct frames.
// A repeated still or a mostly blank clip is not an accepted Spine animation.
import {execFileSync} from 'node:child_process';
import {createHash} from 'node:crypto';
const file=process.argv[2];
if(!file)throw Error('Missing preview candidate');
const width=48,height=48,frameBytes=width*height;
const raw=execFileSync('ffmpeg',[
  '-v','error','-i',file,'-map','0:v:0',
  '-vf',\`scale=\${width}:\${height},format=gray\`,
  '-frames:v','180','-f','rawvideo','-pix_fmt','gray','-'
],{timeout:120000,maxBuffer:2*1024*1024});
if(raw.length%frameBytes)throw Error('Decoded preview has an incomplete frame');
const decoded=raw.length/frameBytes;
const distinct=new Set();let nonzero=0;
for(let offset=0;offset+frameBytes<=raw.length;offset+=frameBytes){
  const frame=raw.subarray(offset,offset+frameBytes);let peak=0,litPixels=0;
  for(const pixel of frame){if(pixel>8)litPixels++;if(pixel>peak)peak=pixel;}
  if(peak>=16&&litPixels>=8){
    nonzero++;
    distinct.add(createHash('sha256').update(frame).digest('hex'));
  }
}
if(decoded<8||nonzero<8||distinct.size<8){
  console.error('PREVIEW_MOTION_REJECTED '+JSON.stringify({decoded,nonzero,distinct:distinct.size}));
  process.exit(1);
}
console.log('PREVIEW_MOTION_ACCEPTED '+JSON.stringify({decoded,nonzero,distinct:distinct.size}));
