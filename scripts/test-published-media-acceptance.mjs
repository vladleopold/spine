import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {verifyPublishedPreviewPair} from '../scripts/lib/published-media-acceptance.mjs';

const origin='https://spine-link.vercel.app';
const prefix='/assets/library_02/fixture-work/';
const videoUrl=origin+prefix+'preview.webm?v=source-a';
const posterUrl=origin+prefix+'preview.webp?v=source-a';
const webm=Buffer.alloc(256,0x5a);
webm.set([0x1a,0x45,0xdf,0xa3],0);
const webp=Buffer.alloc(256,0x22);
webp.write('RIFF',0,'ascii');
webp.write('WEBP',8,'ascii');

function fetchFor(videoStatus=200,posterStatus=200,videoBytes=webm,posterBytes=webp){
  const requests=[];
  const fetchImpl=async(url,options)=>{
    requests.push({url:String(url),range:options?.headers?.Range||''});
    const isVideo=String(url).includes('.webm');
    return new Response(isVideo?videoBytes:posterBytes,{
      status:isVideo?videoStatus:posterStatus,
      headers:{'Content-Type':isVideo?'video/webm':'image/webp'},
    });
  };
  return {fetchImpl,requests};
}

test('published preview acceptance downloads the full exact pair and invokes both decoders',async()=>{
  const {fetchImpl,requests}=fetchFor();
  let decodeCalls=0;
  const ok=await verifyPublishedPreviewPair({
    videoUrl,posterUrl,expectedPrefix:prefix,fetchImpl,
    verifyFiles:async(videoPath,posterPath)=>{
      decodeCalls++;
      assert.equal(fs.readFileSync(videoPath).subarray(0,4).toString('hex'),'1a45dfa3');
      assert.equal(fs.readFileSync(posterPath).subarray(0,4).toString('ascii'),'RIFF');
      assert.equal(fs.statSync(videoPath).size,256);
      assert.equal(fs.statSync(posterPath).size,256);
      return true;
    },
  });
  assert.equal(ok,true);
  assert.equal(decodeCalls,1);
  assert.equal(requests.length,2);
  assert.ok(requests.every(request=>request.range===''),
    'the production verifier must download full media, not only a byte-range prefix');
});

test('a poster from another work is rejected before any network request',async()=>{
  const {fetchImpl,requests}=fetchFor();
  const ok=await verifyPublishedPreviewPair({
    videoUrl,posterUrl:origin+'/assets/library_02/other-work/preview.webp',
    expectedPrefix:prefix,fetchImpl,verifyFiles:async()=>true,
  });
  assert.equal(ok,false);
  assert.equal(requests.length,0);
});

test('HTTP failures and invalid media bytes fail closed',async()=>{
  const forbidden=fetchFor(403,200);
  assert.equal(await verifyPublishedPreviewPair({
    videoUrl,posterUrl,expectedPrefix:prefix,fetchImpl:forbidden.fetchImpl,
    verifyFiles:async()=>true,
  }),false);
  const corrupt=fetchFor(200,200,Buffer.alloc(256,0),webp);
  assert.equal(await verifyPublishedPreviewPair({
    videoUrl,posterUrl,expectedPrefix:prefix,fetchImpl:corrupt.fetchImpl,
    verifyFiles:async()=>true,
  }),false);
});

test('both production verifiers require the decoded pair gate and install FFmpeg',()=>{
  const latestTen=fs.readFileSync(new URL('./lib/latest-ten-live-audit.mjs',import.meta.url),'utf8');
  const latestTwenty=fs.readFileSync(new URL('./verify-latest-twenty-live.mjs',import.meta.url),'utf8');
  const workflowTen=fs.readFileSync(new URL('../.github/workflows/repair-last-ten-previews.yml',import.meta.url),'utf8');
  const workflowTwenty=fs.readFileSync(new URL('../.github/workflows/repair-latest-twenty-previews.yml',import.meta.url),'utf8');
  assert.match(latestTen,/verifyPublishedPreviewPair/);
  assert.match(latestTwenty,/verifyPublishedPreviewPair/);
  assert.match(latestTwenty,/decodedPairs/);
  assert.match(workflowTen,/Decode 10 actual published WebM\\/WebP pairs/);
  assert.match(workflowTwenty,/Decode 20 actual published WebM\\/WebP pairs/);
  assert.match(workflowTen,/@ffmpeg-installer\\/ffmpeg/);
  assert.match(workflowTwenty,/@ffmpeg-installer\\/ffmpeg/);
});

test('decode or exact first-frame mismatch cannot be marked ready',async()=>{
  const {fetchImpl}=fetchFor();
  assert.equal(await verifyPublishedPreviewPair({
    videoUrl,posterUrl,expectedPrefix:prefix,fetchImpl,
    verifyFiles:async()=>{throw new Error('motion or poster mismatch');},
  }),false);
});
