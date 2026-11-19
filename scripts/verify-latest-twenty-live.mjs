#!/usr/bin/env node
// Independent verification against the *published* gallery, not CI metadata.
// Only aggregated counts are emitted: never print original filenames or pixels.
import {previewSourceFingerprint} from './repair-manifest-guard.mjs';
const repo='vladleopold/spine';
const snapshot=JSON.parse(process.env.REPAIR_IDS_JSON||'[]');
if(snapshot.length!==20)throw Error('Expected frozen snapshot of 20 works');
const token=process.env.GITHUB_TOKEN||'';
const headers={Accept:'application/vnd.github+json',...(token?{Authorization:'Bearer '+token}:{})};
const cache=new Map();
async function getIndex(collection){
  if(cache.has(collection))return cache.get(collection);
  if(!/^library(?:_\d+)?$/.test(collection))throw Error('Unsafe collection');
  const response=await fetch('https://api.github.com/repos/'+repo+
    '/contents/'+collection+'/index.json?ref=main',
    {headers,signal:AbortSignal.timeout(30000),cache:'no-store'});
  if(!response.ok)throw Error('Cannot read current index '+response.status);
  const body=await response.json();
  const index=JSON.parse(Buffer.from(body.content.replace(/\s/g,''),'base64').toString('utf8'));
  if(!Array.isArray(index))throw Error('Invalid published index');
  cache.set(collection,index);
  return index;
}
const fields=[
  ['webmPreview','webm'],['webmPreviewMedium','webm'],['webmPreviewLow','webm'],
  ['webpPoster','webp'],['webpPosterMedium','webp'],['webpPosterLow','webp'],
];
async function checkMedia(mediaUrl,type,prefix){
  let parsed;
  try{
    parsed=new URL(mediaUrl);
    if(parsed.origin!=='https://spine-link.vercel.app'||
        !parsed.pathname.startsWith(prefix))return false;
  }catch{return false;}
  for(let retry=0;retry<3;retry++){
    try{
      const response=await fetch(parsed,{headers:{Range:'bytes=0-16383','Cache-Control':'no-cache'},
        signal:AbortSignal.timeout(20000)});
      if(!response.ok)continue;
      const bytes=new Uint8Array(await response.arrayBuffer());
      if(type==='webm'&&bytes[0]===26&&bytes[1]===69&&bytes[2]===223&&bytes[3]===163)return true;
      if(type==='webp'&&bytes.length>=12&&
         Buffer.from(bytes.subarray(0,4)).toString('ascii')==='RIFF'&&
         Buffer.from(bytes.subarray(8,12)).toString('ascii')==='WEBP')return true;
    }catch{}
    if(retry<2)await new Promise(r=>setTimeout(r,1500*(retry+1)));
  }
  return false;
}
let ready=0,blocked=0,failed=0,verifiedMedia=0,mutatedSource=0;
for(const work of snapshot){
  const index=await getIndex(work.basePath);
  const matching=index.filter(e=>e.id===work.id);
  if(matching.length!==1){failed++;mutatedSource++;continue;}
  const record=matching[0];
  if(previewSourceFingerprint(record)!==work.sourceFingerprint){failed++;mutatedSource++;continue;}
  if(record.webmStatus==='blocked-missing-source'){
    const source=Array.isArray(record.files)?record.files:[];
    const triad=source.some(x=>/\.(skel|json)$/i.test(x))&&
      source.some(x=>/\.atlas(?:\.txt|\.docx)?$/i.test(x))&&
      source.some(x=>/\.(png|jpe?g|dds|webp)$/i.test(x));
    if(triad)failed++;else blocked++;
    continue;
  }
  if(record.webmStatus!=='ready'||fields.some(([key])=>!record[key])){failed++;continue;}
  const prefix='/assets/'+work.previewPath+'/';
  const checks=await Promise.all(fields.map(async ([key,type])=>
    checkMedia(record[key],type,prefix)));
  verifiedMedia+=checks.filter(Boolean).length;
  if(checks.every(Boolean))ready++;
  else failed++;
}
console.log('LATEST20_PRODUCTION_MEDIA_AUDIT='+JSON.stringify({
  total:snapshot.length,ready,blocked,failed,mediaVerified:verifiedMedia,
  expectedMedia:snapshot.length*fields.length,mutatedSource
}));
if(failed||ready+blocked!==snapshot.length)process.exitCode=1;
