#!/usr/bin/env node
// Verifies real motion in a decoded preview without emitting pixels or paths.
// Separate from byte/header checks: a static black clip is not an animation.
import {execFileSync} from 'node:child_process';
const file=process.argv[2];
if(!file)throw Error('Missing preview candidate');
const text=execFileSync('ffmpeg',[
  '-v','error','-i',file,'-map','0:v:0',
  '-vf','scale=48:48','-frames:v','180','-f','framemd5','-'
],{encoding:'utf8',timeout:120000,maxBuffer:1024*1024});
const hashes=text.split('\n').filter(x=>/^\s*\d+\s*,/.test(x))
  .map(row=>row.split(',').at(-1).trim());
const unique=new Set(hashes);
if(hashes.length<8||unique.size<8){
  console.error('PREVIEW_MOTION_REJECTED '+JSON.stringify({decoded:hashes.length,distinct:unique.size}));
  process.exit(1);
}
console.log('PREVIEW_MOTION_ACCEPTED '+JSON.stringify({decoded:hashes.length,distinct:unique.size}));
