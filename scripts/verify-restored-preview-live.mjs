#!/usr/bin/env node
// Read-only live audit. Logs only HTTP/status and aggregate proof, not media.
import fs from 'node:fs';
import assert from 'node:assert/strict';
const index=JSON.parse(fs.readFileSync('library_02/index.json','utf8'));
const id='Spine-animation-2026-11-17T18-27-52-258Z';
const entry=index.find(x=>x.id===id);
assert.ok(entry,'Restored Spine source missing');
assert.equal(entry.webmStatus,'ready','Source is not published ready');
assert.ok(entry.previewFrameCount>=8&&entry.previewDuration>=0.5,
  'Video lacks decoded frame-count evidence');
const pairs=[
  ['webmPreview','preview.webm','webm'],
  ['webmPreviewMedium','preview-medium.webm','webm'],
  ['webmPreviewLow','preview-low.webm','webm'],
  ['webpPoster','preview.webp','webp'],
  ['webpPosterMedium','preview-medium.webp','webp'],
  ['webpPosterLow','preview-low.webp','webp']
];
const base='https://spine-link.vercel.app/assets/'+entry.previewPath+'/';
function matches(bytes,kind) {
  if(kind==='webm')return bytes.length>=4&&bytes[0]===0x1a&&
    bytes[1]===0x45&&bytes[2]===0xdf&&bytes[3]===0xa3;
  return bytes.length>=12&&Buffer.from(bytes.subarray(0,4)).toString('ascii')==='RIFF'&&
    Buffer.from(bytes.subarray(8,12)).toString('ascii')==='WEBP';
}
async function check([field,name,kind]){
  const url=base+name;
  assert.equal(entry[field],url,'Unexpected indexed media filename');
  let last='no response';
  for(let attempt=0;attempt<4;attempt++){
    try {
      const response=await fetch(url,{headers:{
        Range:'bytes=0-65535','Cache-Control':'no-cache'
      },signal:AbortSignal.timeout(18000),cache:'no-store'});
      const bytes=response.ok?new Uint8Array(await response.arrayBuffer()):new Uint8Array();
      if(response.ok&&matches(bytes,kind)){
        console.log('LIVE_SPINE_MEDIA_OK type='+kind+' tier='+name.split('.')[0]+' status='+response.status);
        return true;
      }
      last='HTTP '+response.status+', magic='+String(matches(bytes,kind));
    }catch(error){last=String(error.name||'FETCH_ERROR')}
    if(attempt<3)await new Promise(resolve=>setTimeout(resolve,1500*(attempt+1)));
  }
  console.error('LIVE_SPINE_MEDIA_FAILED type='+kind+' tier='+name.split('.')[0]+' reason='+last);
  return false;
}
const results=await Promise.all(pairs.map(check));
const passed=results.filter(Boolean).length;
console.log('RESTORED_PREVIEW_LIVE_AUDIT='+JSON.stringify({total:6,passed,failed:6-passed}));
if(passed!==6)process.exitCode=1;
