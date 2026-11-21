#!/usr/bin/env node
// Validate 18 reported works and the separately prioritized work against production.
// Only aggregate counts are printed; work identifiers, asset URLs and frame data stay out of logs.
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {execFileSync} from "node:child_process";
import {fileURLToPath} from "node:url";
import {readIndex} from "./resolve-library.mjs";
import {
  hasWebmSignature,
  hasWebpSignature,
  isSameWorkMediaPair,
} from "./lib/reported-preview-media.mjs";
import {
  classifyPreviewHttpStatus,
  classifyReportedPreviewEntry,
} from "./lib/reported-preview-live-status.mjs";

const ids=[
  "boss_1-2026-11-14T20-07-17-943Z",
  "Spine-animation-2026-11-14T22-21-53-616Z",
  "Spine-animation-2026-11-17T05-25-45-640Z",
  "Spine-animation-2026-11-17T05-40-26-980Z",
  "wolf-2026-11-17T07-14-36-248Z",
  "wolf_v13-2026-11-17T15-57-55-338Z",
  "config-2026-11-17T17-15-57-407Z",
  "Spine-animation-2026-11-17T18-04-48-688Z",
  "Spine-animation-2026-11-17T17-50-04-803Z",
  "Spine-animation-2026-11-17T18-06-25-641Z",
  "Spine-animation-2026-11-17T18-07-35-146Z",
  "Spine-animation-2026-11-17T18-17-09-503Z",
  "Spine-animation-2026-11-17T18-19-06-491Z",
  "Spine-animation-2026-11-17T18-26-20-981Z",
  "Spine-animation-2026-11-17T18-26-38-201Z",
  "Spine-animation-2026-11-17T18-27-52-258Z",
  "Spine-animation-2026-11-17T18-36-51-976Z",
  "Spine-animation-2026-11-17T18-39-06-745Z"
];
const priorityId="Spine-animation-2026-11-17T18-45-14-132Z";
const allIds=[...ids,priorityId];
const entries=readIndex(process.cwd(),"library_02")||[];
const tempDir=fs.mkdtempSync(path.join(os.tmpdir(),"spine-reported-preview-live-"));
const motionVerifier=fileURLToPath(new URL("./verify-preview-motion.mjs",import.meta.url));
const posterVerifier=fileURLToPath(new URL("./verify-poster-first-frame.mjs",import.meta.url));
const auditNonce=Date.now();
let ready=0,blocked=0,failed=0,mediaVerified=0,postersDecoded=0,motionVerified=0,posterFrameVerified=0,statusMismatch=0,identityBlocked=0;

class PreviewAuditError extends Error {
  constructor(message,status=0){super(message);this.status=status;}
}

async function fetchMedia(url,kind,destination) {
  if(!url||!url.startsWith("https://spine-link.vercel.app/assets/library_02/"))
    throw new PreviewAuditError("asset-url",404);
  let response;
  try {
    response=await fetch(url+(url.includes("?")?"&":"?")+"audit="+auditNonce,{
      signal:AbortSignal.timeout(20000),cache:"no-store"
    });
  } catch {
    throw new PreviewAuditError("asset-network",0);
  }
  if(!response.ok)throw new PreviewAuditError("asset-http",response.status);
  const bytes=Buffer.from(await response.arrayBuffer());
  const valid=kind==="webm"?hasWebmSignature(bytes):hasWebpSignature(bytes);
  if(!valid)throw new PreviewAuditError("asset-signature",404);
  fs.writeFileSync(destination,bytes);
  mediaVerified++;
}

function decodePoster(file) {
  try {
    const result=JSON.parse(execFileSync("ffprobe",[
      "-v","error","-select_streams","v:0","-show_entries","stream=width,height","-of","json",file
    ],{encoding:"utf8",timeout:30000}));
    const stream=result.streams?.[0]||{};
    if(!(Number(stream.width)>0&&Number(stream.height)>0))throw new Error("poster-dimensions");
    execFileSync("ffmpeg",["-v","error","-i",file,"-frames:v","1","-f","null","-"],{
      stdio:"ignore",timeout:30000
    });
    postersDecoded++;
  } catch {
    throw new PreviewAuditError("poster-decode",422);
  }
}

function verifyMotion(file) {
  try {
    const result=JSON.parse(execFileSync("ffprobe",[
      "-v","error","-count_frames","-select_streams","v:0",
      "-show_entries","stream=width,height,nb_read_frames:format=duration","-of","json",file
    ],{encoding:"utf8",timeout:30000}));
    const stream=result.streams?.[0]||{};
    const frames=Number(stream.nb_read_frames);
    const duration=Number(result.format?.duration);
    if(!(Number(stream.width)>0&&Number(stream.height)>0&&frames>=8&&duration>=0.5&&frames/duration>=15))
      throw new Error("video-frame-count");
    execFileSync(process.execPath,[motionVerifier,file],{stdio:"ignore",timeout:120000});
    motionVerified++;
  } catch {
    throw new PreviewAuditError("video-motion",422);
  }
}

function verifyPosterFirstFrame(video,poster) {
  try {
    execFileSync(process.execPath,[posterVerifier,video,poster],{stdio:"ignore",timeout:60000});
    posterFrameVerified++;
  } catch {
    throw new PreviewAuditError("poster-frame-mismatch",422);
  }
}

try {
  for(let index=0;index<allIds.length;index++) {
    const entry=entries.find(item=>item.id===allIds[index]);
    if(!entry){failed++;continue;}
    const selected=typeof entry.defaultAnimation==="string"?entry.defaultAnimation:"";
    const sourceHasSelection=Boolean(selected)&&Array.isArray(entry.animations)&&entry.animations.includes(selected);
    if(!sourceHasSelection){blocked++;identityBlocked++;continue;}
    const status=classifyReportedPreviewEntry(entry);
    const tiers=[
      {video:entry.webmPreview,poster:entry.webpPoster||entry.thumbnailPoster},
      {video:entry.webmPreviewMedium,poster:entry.webpPosterMedium},
      {video:entry.webmPreviewLow,poster:entry.webpPosterLow}
    ];
    try {
      for(let tier=0;tier<tiers.length;tier++) {
        const pair=tiers[tier];
        if(!isSameWorkMediaPair(pair.video,pair.poster))throw new PreviewAuditError("media-pair",404);
        const videoFile=path.join(tempDir,"video-"+index+"-"+tier+".webm");
        const posterFile=path.join(tempDir,"poster-"+index+"-"+tier+".webp");
        await fetchMedia(pair.video,"webm",videoFile);
        await fetchMedia(pair.poster,"webp",posterFile);
        decodePoster(posterFile);
        verifyMotion(videoFile);
        verifyPosterFirstFrame(videoFile,posterFile);
      }
      if(status==="ready")ready++;
      else {
        statusMismatch++;
        if(status==="blocked"){blocked++;if(entry.webmAnimation!==selected)identityBlocked++;}
        else failed++;
      }
    } catch(error) {
      const classification=classifyPreviewHttpStatus(Number(error?.status)||0);
      if(classification==="blocked")blocked++;
      else failed++;
    }
  }
  const summary={
    requested:allIds.length,ready,blocked,failed,mediaVerified,postersDecoded,
    motionVerified,posterFrameVerified,statusMismatch,identityBlocked
  };
  console.log("REPORTED_PREVIEW_PRODUCTION_AUDIT="+JSON.stringify(summary));
  if(ready+blocked+failed!==allIds.length||failed>0||blocked>0||statusMismatch>0)
    process.exitCode=1;
} finally {
  fs.rmSync(tempDir,{recursive:true,force:true});
}
