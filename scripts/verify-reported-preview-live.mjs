#!/usr/bin/env node
// Validate the 18 reported works and the separately prioritized work against production.
// Only aggregate counts are printed; private work identifiers and asset URLs stay out of logs.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {readIndex} from './resolve-library.mjs';
import {
  hasWebmSignature,
  hasWebpSignature,
  isSameWorkMediaPair,
} from './lib/reported-preview-media.mjs';

const ids=["boss_1-2026-11-14T20-07-17-943Z","Spine-animation-2026-11-14T22-21-53-616Z","Spine-animation-2026-11-17T05-25-45-640Z","Spine-animation-2026-11-17T05-40-26-980Z","wolf-2026-11-17T07-14-36-248Z","wolf_v13-2026-11-17T15-57-55-338Z","config-2026-11-17T17-15-57-407Z","Spine-animation-2026-11-17T18-04-48-688Z","Spine-animation-2026-11-17T17-50-04-803Z","Spine-animation-2026-11-17T18-06-25-641Z","Spine-animation-2026-11-17T18-07-35-146Z","Spine-animation-2026-11-17T18-17-09-503Z","Spine-animation-2026-11-17T18-19-06-491Z","Spine-animation-2026-11-17T18-26-20-981Z","Spine-animation-2026-11-17T18-26-38-201Z","Spine-animation-2026-11-17T18-27-52-258Z","Spine-animation-2026-11-17T18-36-51-976Z","Spine-animation-2026-11-17T18-39-06-745Z"];
const priorityId="Spine-animation-2026-11-17T18-45-14-132Z";
const allIds=[...ids,priorityId];
const entries=readIndex(process.cwd(),'library_02')||[];
const tempDir=fs.mkdtempSync(path.join(os.tmpdir(),'spine-reported-preview-live-'));
const motionVerifier=fileURLToPath(new URL('./verify-preview-motion.mjs',import.meta.url));
const posterVerifier=fileURLToPath(new URL('./verify-poster-first-frame.mjs',import.meta.url));
const auditNonce=Date.now();
let ready=0,blocked=0,failed=0,mediaVerified=0,postersDecoded=0,motionVerified=0,statusMismatch=0;

async function fetchMedia(url,kind,destination) {
  if(!url||!url.startsWith('https://spine-link.vercel.app/assets/library_02/'))
    throw new Error('asset-url');
  const response=await fetch(url+(url.includes('?')?'&':'?')+'audit='+auditNonce,{
    signal:AbortSignal.timeout(20000),cache:'no-store'
  });
  if(!response.ok)throw new Error('asset-http');
  const bytes=Buffer.from(await response.arrayBuffer());
  const valid=kind==='webm'?hasWebmSignature(bytes):hasWebpSignature(bytes);
  if(!valid)throw new Error('asset-signature');
  fs.writeFileSync(destination,bytes);
  mediaVerified++;
}

function decodePoster(file) {
  const result=JSON.parse(execFileSync('ffprobe',[
    '-v','error','-select_streams','v:0','-show_entries','stream=width,height','-of','json',file
  ],{encoding:'utf8',timeout:30000}));
  const stream=result.streams?.[0]||{};
  if(!(Number(stream.width)>0&&Number(stream.height)>0))throw new Error('poster-dimensions');
  execFileSync('ffmpeg',['-v','error','-i',file,'-frames:v','1','-f','null','-'],{
    stdio:'ignore',timeout:30000
  });
  postersDecoded++;
}

function verifyMotion(file) {
  const result=JSON.parse(execFileSync('ffprobe',[
    '-v','error','-count_frames','-select_streams','v:0',
    '-show_entries','stream=width,height,nb_read_frames:format=duration','-of','json',file
  ],{encoding:'utf8',timeout:30000}));
  const stream=result.streams?.[0]||{};
  const frames=Number(stream.nb_read_frames);
  const duration=Number(result.format?.duration);
  if(!(Number(stream.width)>0&&Number(stream.height)>0&&frames>=8&&duration>=0.5&&frames/duration>=15))
    throw new Error('video-frame-count');
  execFileSync(process.execPath,[motionVerifier,file],{stdio:'ignore',timeout:120000});
  motionVerified++;
}

try {
  for(let index=0;index<allIds.length;index++) {
    const entry=entries.find(item=>item.id===allIds[index]);
    if(!entry){failed++;continue;}
    const status=String(entry.webmStatus||'pending');
    const isBlocked=status.startsWith('blocked-')||entry.previewStatus==='blocked';
    const posterUrl=entry.webpPoster||entry.thumbnailPoster||'';
    if(!entry.webmPreview||!posterUrl||!isSameWorkMediaPair(entry.webmPreview,posterUrl)) {
      if(isBlocked)blocked++;else failed++;
      continue;
    }
    const videoFile=path.join(tempDir,'video-'+index+'.webm');
    const posterFile=path.join(tempDir,'poster-'+index+'.webp');
    try {
      await fetchMedia(entry.webmPreview,'webm',videoFile);
      await fetchMedia(posterUrl,'webp',posterFile);
      decodePoster(posterFile);
      verifyMotion(videoFile);
      execFileSync(process.execPath,[posterVerifier,videoFile,posterFile],{stdio:'ignore',timeout:60000});
      if(status==='ready'&&entry.previewStatus==='ready')ready++;
      else {
        statusMismatch++;
        if(isBlocked)blocked++;else failed++;
      }
    } catch {
      if(isBlocked)blocked++;else failed++;
    }
  }
  const summary={
    requested:allIds.length,ready,blocked,failed,mediaVerified,postersDecoded,motionVerified,statusMismatch
  };
  console.log('REPORTED_PREVIEW_PRODUCTION_AUDIT='+JSON.stringify(summary));
  if(ready+blocked+failed!==allIds.length||failed>0||blocked>0||statusMismatch>0)
    process.exitCode=1;
} finally {
  fs.rmSync(tempDir,{recursive:true,force:true});
}
