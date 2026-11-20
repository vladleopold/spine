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
  // GitHub's Contents API omits `content` and returns encoding=none for
  // files larger than 1 MiB. library_02/index.json exceeds that limit, so
  // parsing body.content produces `Unexpected end of JSON input` after a
  // successful publication. Read the public raw JSON directly instead.
  const rawUrl='https://raw.githubusercontent.com/'+repo+'/main/'+
    collection+'/index.json';
  const response=await fetch(rawUrl,{
    signal:AbortSignal.timeout(30000),cache:'no-store',
    headers:{'Cache-Control':'no-cache'},
  });
  if(!response.ok)throw Error('Cannot read current raw index '+response.status);
  const index=await response.json();
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
async function exactMediaFilesExist(work){
  const dir=work.previewPath.split('/').map(encodeURIComponent).join('/');
  try{
    const response=await fetch('https://api.github.com/repos/'+repo+
      '/contents/'+dir+'?ref=main',{headers,
      signal:AbortSignal.timeout(30000),cache:'no-store'});
    if(!response.ok)return false;
    const body=await response.json();
    if(!Array.isArray(body))return false;
    const names=new Set(body.map(x=>x.name));
    return ['preview.webm','preview-medium.webm','preview-low.webm',
      'preview.webp','preview-medium.webp','preview-low.webp'].every(x=>names.has(x));
  }catch{return false;}
}
let ready=0,blocked=0,failed=0,verifiedMedia=0,mutatedSource=0;
for(const work of snapshot){
  const index=await getIndex(work.basePath);
  const matching=index.filter(e=>e.id===work.id);
  if(matching.length!==1){failed++;mutatedSource++;continue;}
  const record=matching[0];
  if(previewSourceFingerprint(record)!==work.sourceFingerprint){failed++;mutatedSource++;continue;}
  const hasExactDefaultAnimation=typeof record.defaultAnimation==='string'&&record.defaultAnimation.length>0;
  if(record.webmStatus==='blocked-missing-animation-selection'&&record.previewStatus==='blocked'&&!hasExactDefaultAnimation){
    blocked++;
    continue;
  }
  if(record.webmStatus==='blocked-incompatible-source-version'){
    if(String(record.previewError||'').includes('Spine 3.8.75'))blocked++;
    else failed++;
    continue;
  }
  if(record.webmStatus==='blocked-missing-source'){
    const source=Array.isArray(record.files)?record.files:[];
    const triad=source.some(x=>/\.(skel|json)$/i.test(x))&&
      source.some(x=>/\.atlas(?:\.txt|\.docx)?$/i.test(x))&&
      source.some(x=>/\.(png|jpe?g|dds|webp)$/i.test(x));
    if(triad)failed++;else blocked++;
    continue;
  }
  if(record.webmStatus!=='ready'||fields.some(([key])=>!record[key])){failed++;continue;}
  if(!await exactMediaFilesExist(work)){failed++;continue;}
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
