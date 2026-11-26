#!/usr/bin/env node
// Independent verification against the *published* gallery, not CI metadata.
// Only aggregated counts are emitted: never print original filenames or pixels.
import {previewSourceFingerprint} from './repair-manifest-guard.mjs';
const repo='vladleopold/spine';
const publishedSha=String(process.env.PUBLISHED_SHA||'');
if(!/^[a-f0-9]{40}$/i.test(publishedSha))throw new Error('Missing immutable published commit SHA');
const repairLimit=Number(process.env.SPINE_REPAIR_LIMIT||20);
if(!Number.isInteger(repairLimit)||repairLimit<1||repairLimit>50)throw new Error('SPINE_REPAIR_LIMIT must be an integer from 1 to 50');
const snapshot=process.env.REPAIR_IDS_FILE
  ? JSON.parse(await (await import('node:fs/promises')).readFile(process.env.REPAIR_IDS_FILE,'utf8'))
  : JSON.parse(process.env.REPAIR_IDS_JSON||'[]');
if(!Array.isArray(snapshot)||snapshot.length===0||snapshot.length>repairLimit)throw Error(`Expected a non-empty frozen snapshot of at most ${repairLimit} works`);
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
  // Pin the index to the exact commit published by the preceding job.
  // raw.githubusercontent.com may briefly serve a stale main ref via its CDN.
  const rawUrl='https://raw.githubusercontent.com/'+repo+'/'+publishedSha+'/'+
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
let ready=0,blocked=0,failed=0,verifiedMedia=0,mutatedSource=0,claimedReady=0;
for(const work of snapshot){
  const index=await getIndex(work.basePath);
  const matching=index.filter(e=>e.id===work.id);
  if(matching.length!==1){failed++;mutatedSource++;continue;}
  const record=matching[0];
  if(previewSourceFingerprint(record)!==work.sourceFingerprint){failed++;mutatedSource++;continue;}
  if(record.webmStatus==='ready')claimedReady++;
  // Classify source blockers from the frozen inventory snapshot. Some blockers
  // (notably legacy binary-only Spine 3.7 and incomplete atlas page inventories)
  // are intentionally written without renderer-selection fingerprints because
  // no render was attempted. Requiring those render-only fields mislabels safe,
  // unchanged blocked sources as production failures.
  // The frozen inventory is authoritative for source readiness. A source
  // that could not be rendered because it is incomplete or unsupported remains
  // a blocker even when the publisher uses a more general blocked-missing-source
  // status (for example, an atlas with unprovided secondary pages).
  if(work.ready===false &&
      ['SPINE_VERSION_UNKNOWN','UNSUPPORTED_SPINE_WEB_PLAYER_VERSION','UNSUPPORTED_SPINE_3_7_BINARY_SKELETON'].includes(work.blockedReason) &&
      record.webmStatus==='failed' && record.previewStatus==='failed'){
    // The inventory has proved these exact sources cannot be rendered by the
    // pinned runtime. Historical failed labels are source blockers, not new
    // production-media failures; keep any ready media on the normal verify path.
    blocked++;
    continue;
  }
  if(work.ready===false && record.previewStatus==='blocked' &&
      typeof record.webmStatus==='string' && record.webmStatus.startsWith('blocked-')){
    blocked++;
    continue;
  }
  // If the inventory cannot render this source, stale failed/pending labels or
  // incomplete old media must not be reported as renderer regressions. Preserve
  // verified existing media, but classify unrecoverable source records as blocked.
  if(work.ready===false &&
      (record.webmStatus!=='ready' || fields.some(([key])=>!record[key]))){
    blocked++;
    continue;
  }
  if(record.webmStatus==='blocked-missing-animation-selection'&&record.previewStatus==='blocked'&&!String(record.defaultAnimation||'').trim()){
    blocked++;
    continue;
  }
  const expectedBlockedAnimation=String(work.animation||record.defaultAnimation||'');
  const blockedAnimationMatches=expectedBlockedAnimation==='__SPINE_AUTO__'
    ? Boolean(String(record.previewBlockedAnimation||'').trim())
    : record.previewBlockedAnimation===expectedBlockedAnimation;
  if(['blocked-invisible-default-skin','blocked-static-animation','blocked-invalid-default-animation',
      'blocked-incomplete-source','blocked-unsupported-runtime'].includes(record.webmStatus) &&
      record.previewStatus==='blocked' &&
      blockedAnimationMatches &&
      record.previewBlockedSourceFingerprint===work.sourceFingerprint &&
      String(record.previewBlockedSkin||'')===String(record.defaultSkin||record.skin||'')){
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
  if(!await exactMediaFilesExist(work)){if(work.ready===false)blocked++;else failed++;continue;}
  const prefix='/assets/'+work.previewPath+'/';
  const checks=await Promise.all(fields.map(async ([key,type])=>
    checkMedia(record[key],type,prefix)));
  verifiedMedia+=checks.filter(Boolean).length;
  if(checks.every(Boolean))ready++;
  else if(work.ready===false)blocked++;
  else failed++;
}
const renderableCandidates=snapshot.filter(work=>work.ready===true).length;
const inventoryBlocked=snapshot.length-renderableCandidates;
const expectedMedia=claimedReady*fields.length;
console.log('LATEST_PRODUCTION_MEDIA_AUDIT='+JSON.stringify({limit:repairLimit,
  total:snapshot.length,renderableCandidates,inventoryBlocked,ready,blocked,failed,mediaVerified:verifiedMedia,
  expectedMedia,mutatedSource
}));
// A failed render for one item is reported, but it must not stop the next
// archive offset. Every record marked ready must still have all production media
// verified, and the source fingerprint / row classification must remain intact.
if(mutatedSource||verifiedMedia!==expectedMedia||ready+blocked+failed!==snapshot.length)process.exitCode=1;
