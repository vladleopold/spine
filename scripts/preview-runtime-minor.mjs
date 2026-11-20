#!/usr/bin/env node
// Inspect only the source header to select a matching Spine Web Player.
import fs from 'node:fs';
import path from 'node:path';
import { previewRuntimeMinor } from './lib/preview-runtime-minor.mjs';
const dir=path.resolve(process.argv[2]||'');
const names=fs.readdirSync(dir);
const candidates=names.filter(n=>/\.(json|skel)$/i.test(n));
let version='';
for(const name of candidates){
 const file=path.join(dir,name);
 if(name.endsWith('.json')){
  try{const j=JSON.parse(fs.readFileSync(file,'utf8'));if(Array.isArray(j.bones)){version=String(j.skeleton?.spine||'');break;}}catch{}
 }else{
  try{
   const bytes=fs.readFileSync(file);let pos=0;
   const readInt=()=>{let result=0,shift=0;for(let i=0;i<5;i++){const b=bytes[pos++];result|=(b&127)<<shift;if(!(b&128))return result>>>0;shift+=7;}throw Error('Invalid varint')};
   const readStr=()=>{const len=readInt();if(len<2)return '';const s=bytes.subarray(pos,pos+len-1).toString('utf8');pos+=len-1;return s};
   readStr();version=readStr();if(/^\d+\.\d+/.test(version))break;
  }catch{}
 }
}
console.log(previewRuntimeMinor(version));