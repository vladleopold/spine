#!/usr/bin/env node
// Production proof for every newest ready Spine preview; no fake placeholders.
import {readIndex,listCollectionFolders} from './resolve-library.mjs';
import fs from 'node:fs';
const entries=[];
for(const folder of listCollectionFolders(process.cwd())){
 for(const entry of readIndex(process.cwd(),folder)||[]){
  if(entry?.hiddenFromPublicLibrary !== true && entry?.testOnly !== true && /^Spine-animation-\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d-\d{3}Z$/.test(entry?.id||''))
   entries.push(entry);
 }
}
const latest=entries.sort((a,b)=>Date.parse(b.uploadedAt||0)-Date.parse(a.uploadedAt||0)).slice(0,10);
if(latest.length!==10)throw Error('Expected ten actual entries');
const tasks=[];
for(const entry of latest.filter(e=>e.webmStatus==='ready')){
 for(const [ext,url] of [['webm',entry.webmPreview],['webp',entry.webpPoster||entry.thumbnailPoster]]){
  if(!/^https:\/\/spine-link\.vercel\.app\/assets\/library_/.test(url||''))
   throw Error('Invalid production media URL in public entry');
  tasks.push({ext,url:url+(url.includes('?')?'&':'?')+
   'v='+encodeURIComponent('verify-'+(entry.webmGeneratedAt||'public'))});
 }
}
let verified=0,errors=0;
async function inspect(t){
 let last='no response';
 for(let attempt=0;attempt<3;attempt++){
  try{
   const response=await fetch(t.url,{signal:AbortSignal.timeout(14000),cache:'no-store'});
   if(!response.ok){last='HTTP '+response.status;continue;}
   const contentType=response.headers.get('content-type')||'';
   const data=new Uint8Array(await response.arrayBuffer());
   const valid=t.ext==='webm'
    ?data[0]===0x1a&&data[1]===0x45&&data[2]===0xdf&&data[3]===0xa3
    :String.fromCharCode(...data.slice(0,4))==='RIFF'&&
      String.fromCharCode(...data.slice(8,12))==='WEBP';
   if(valid&&data.length>128&&contentType.includes(t.ext==='webm'?'video/webm':'image/webp')){
    return {ok:true,ext:t.ext,bytes:data.length};
   }
   last='invalid media body or content type';
  }catch(e){last=e?.name||'network error';}
  await new Promise(r=>setTimeout(r,1000));
 }
 return {ok:false,ext:t.ext,error:last};
}
for(let i=0;i<tasks.length;i+=4){
 const batch=await Promise.all(tasks.slice(i,i+4).map(inspect));
 for(const result of batch){
  console.log('PRODUCTION_MEDIA_EVIDENCE '+JSON.stringify({ok:result.ok,ext:result.ext,bytes:result.bytes||0,error:result.error||''}));
  if(result.ok)verified++;else errors++;
 }
}
const summary={total:latest.length,ready:latest.filter(x=>x.webmStatus==='ready').length,
 blocked:latest.filter(x=>x.webmStatus==='blocked-missing-source').length,
 failed:latest.filter(x=>x.webmStatus==='failed').length,
 checked:tasks.length,verified,errors};
console.log('PRODUCTION_PREVIEW_SUMMARY='+JSON.stringify(summary));
if(errors)process.exitCode=1;
