#!/usr/bin/env node
// Validate public Spine work media strictly from production after CI publication.
import fs from 'node:fs';
import {readIndex} from './resolve-library.mjs';
const ids=["boss_1-2026-11-14T20-07-17-943Z","Spine-animation-2026-11-14T22-21-53-616Z","Spine-animation-2026-11-17T05-25-45-640Z","Spine-animation-2026-11-17T05-40-26-980Z","wolf-2026-11-17T07-14-36-248Z","wolf_v13-2026-11-17T15-57-55-338Z","config-2026-11-17T17-15-57-407Z","Spine-animation-2026-11-17T18-04-48-688Z","Spine-animation-2026-11-17T17-50-04-803Z","Spine-animation-2026-11-17T18-06-25-641Z","Spine-animation-2026-11-17T18-07-35-146Z","Spine-animation-2026-11-17T18-17-09-503Z","Spine-animation-2026-11-17T18-19-06-491Z","Spine-animation-2026-11-17T18-26-20-981Z","Spine-animation-2026-11-17T18-26-38-201Z","Spine-animation-2026-11-17T18-27-52-258Z","Spine-animation-2026-11-17T18-36-51-976Z","Spine-animation-2026-11-17T18-39-06-745Z"];
const entries=readIndex(process.cwd(),'library_02')||[];
let ready=0,blocked=0,failed=0,verified=0;
for(let slot=0;slot<ids.length;slot++){
 const id=ids[slot];
 const e=entries.find(x=>x.id===id);
 if(!e){console.error('SOURCE_INDEX_MISSING slot='+slot);failed++;continue;}
 if(e.webmStatus!=='ready'){
  if(e.webmStatus==='blocked-missing-source')blocked++;else failed++;
  console.log('PREVIEW_NOT_READY slot='+slot+' state='+String(e.webmStatus||'pending'));
  continue;
 }
 const assets=[['webm',e.webmPreview],['webp',e.webpPoster||e.thumbnailPoster]];
 let pass=true;
 for(const [kind,url] of assets){
  if(!url||!url.startsWith('https://spine-link.vercel.app/assets/')){pass=false;break;}
  try{
   const resp=await fetch(url+(url.includes('?')?'&':'?')+'check='+encodeURIComponent(e.webmGeneratedAt||id),{signal:AbortSignal.timeout(20000),cache:'no-store'});
   if(!resp.ok){pass=false;break;}
   const buf=new Uint8Array(await resp.arrayBuffer());
   const sig=kind==='webm'?buf[0]===26&&buf[1]===69&&buf[2]===223&&buf[3]===163:
     String.fromCharCode(...buf.slice(0,4))==='RIFF'&&String.fromCharCode(...buf.slice(8,12))==='WEBP';
   if(!sig||buf.length<256){pass=false;break;}
   verified++;
  }catch{pass=false;break;}
 }
 if(pass){ready++;console.log('REPORTED_PREVIEW_LIVE_OK slot='+slot);}
 else{failed++;console.error('REPORTED_PREVIEW_LIVE_FAILED slot='+slot);}
}
const summary={requested:ids.length,ready,blocked,failed,mediaVerified:verified};
console.log('REPORTED_PREVIEW_PRODUCTION_AUDIT='+JSON.stringify(summary));
if(ready+blocked+failed!==ids.length||failed>0||blocked>0)process.exitCode=1;
