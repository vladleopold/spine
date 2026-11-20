#!/usr/bin/env node
/**
 * Fail-closed 10-most-recent Spine preview repair.
 * Runs only on authenticated private Github Actions workers.
 * Source filenames, image bytes and generated previews never appear in logs.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { listCollectionFolders, readIndex } from "./resolve-library.mjs";
import { classifyPublishedPreview, sourceBlocker } from "./lib/reported-preview-acceptance.mjs";

const root=process.cwd();
const requestedIds=[
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
const requestedSet=new Set(requestedIds);
function newestTen() {
  const byId=new Map();
  for(const folder of listCollectionFolders(root)) {
    for(const entry of readIndex(root,folder)||[]) {
      if(!requestedSet.has(entry?.id))continue;
      if(byId.has(entry.id))throw new Error('Duplicate work across archive collections');
      byId.set(entry.id,{id:entry.id,basePath:folder,previewPath:entry.previewPath||folder+'/'+entry.id,
        at:Date.parse(entry.uploadedAt||0)||0});
    }
  }
  const missing=requestedIds.filter(id=>!byId.has(id));
  if(missing.length)throw new Error('Requested Spine works missing from source indexes: '+missing.length);
  return requestedIds.map(id=>byId.get(id));
}
function recordFor(entry) {
  return (readIndex(root,entry.basePath)||[]).find(x=>x.id===entry.id)||null;
}
function bundleBlocker(entry, requestedAnimation="", record=recordFor(entry)) {
  if(!record)return "missing-source";
  let availableFiles=null;
  if(process.env.SPINE_REPAIR_INDEX_ONLY!=="1") {
    const p=path.resolve(root,entry.previewPath);
    if(!p.startsWith(root+path.sep))return "missing-source";
    try {
      availableFiles=new Map();
      for(const file of fs.readdirSync(p)) {
        const full=path.join(p,file);
        if(fs.statSync(full).isFile())availableFiles.set(file,fs.statSync(full).size);
      }
    } catch {
      return "missing-source";
    }
  }
  return sourceBlocker(record,requestedAnimation,availableFiles);
}
const mediaNames=["preview.webm","preview-medium.webm","preview-low.webm",
  "preview.webp","preview-medium.webp","preview-low.webp"];
function existingMediaOk(entry){
  const record=recordFor(entry);
  const acceptance=classifyPublishedPreview(record);
  if(acceptance.status!=="ready")return false;

  // A previously published clip must meet the same frame-density gate before
  // it can suppress a retry. The exact default animation is never substituted.
  const frameCount=Number(record.previewFrameCount||0);
  const duration=Number(record.previewDuration||0);
  if(frameCount>0&&duration>0&&frameCount/duration<15)return false;
  if(entry.id==="Spine-animation-2026-11-17T18-39-06-745Z"&&
    !(frameCount>0&&duration>0&&frameCount/duration>=15))return false;
  if(process.env.SPINE_REPAIR_INDEX_ONLY==="1")return true;

  const localPath=url=>{
    try{
      const pathname=new URL(url).pathname;
      const marker="/assets/";
      const offset=pathname.indexOf(marker);
      if(offset<0)return null;
      const relative=pathname.slice(offset+marker.length);
      const resolved=path.resolve(root,relative);
      return resolved.startsWith(root+path.sep)?resolved:null;
    }catch{return null;}
  };
  for(const tier of acceptance.tiers){
    const video=localPath(tier.webmUrl);
    const poster=localPath(tier.posterUrl);
    if(!video||!poster)return false;
    try{
      if(fs.statSync(video).size<=128||fs.statSync(poster).size<=128)return false;
      const data=JSON.parse(execFileSync("ffprobe",[
        "-v","error","-count_frames","-select_streams","v:0",
        "-show_entries","stream=nb_read_frames,width,height:format=duration",
        "-of","json",video,
      ],{encoding:"utf8",timeout:30000,stdio:["ignore","pipe","ignore"]}));
      const stream=data.streams?.[0]||{};
      const frames=Number(stream.nb_read_frames),seconds=Number(data.format?.duration);
      if(!(frames>=8&&seconds>0&&stream.width>0&&stream.height>0))return false;
      execFileSync(process.execPath,[path.join(root,"scripts/verify-preview-motion.mjs"),video],
        {stdio:"ignore",timeout:120000});
      execFileSync(process.execPath,[path.join(root,"scripts/verify-poster-first-frame.mjs"),video,poster],
        {stdio:"ignore",timeout:120000});
    }catch{return false;}
  }
  return true;
}
const action=process.argv[2]||"matrix";
const latest=newestTen();
if(action==="matrix"){
  if(latest.length!==requestedIds.length)throw new Error("Cannot find 10 recent entries");
  const matrix=latest.map((e,slotIndex)=>{
    const record=recordFor(e);
    const explicitAnimation=e.id==="Spine-animation-2026-11-17T18-44-12-762Z"?"Climax 01":
      e.id==="wolf-2026-11-17T07-14-36-248Z"?"bkg_landscape":
      e.id==="wolf_v13-2026-11-17T15-57-55-338Z"?"bkg_landscape":
      e.id==="Spine-animation-2026-11-17T18-17-09-503Z"?"Brows Crazed":
      e.id==="Spine-animation-2026-11-17T18-19-06-491Z"?"Camera Idle":
      e.id==="Spine-animation-2026-11-17T18-39-06-745Z"?"animation":"";
    // Existing default selection always wins. An explicit manifest selection is
    // used only when the record has no default; no first/alternate track is tried.
    const animation=typeof record?.defaultAnimation==="string"&&record.defaultAnimation.length
      ?record.defaultAnimation:explicitAnimation;
    const blockedReason=bundleBlocker(e,animation,record);
    const ready=!blockedReason;
    const rel=String(e.previewPath).replace(/\\/g,"/");
    if(!rel.startsWith(e.basePath+"/")||rel.split("/").includes(".."))
      throw new Error("Unsafe preview path");
    return {slot:slotIndex+1,id:e.id,basePath:e.basePath,previewPath:rel,ready,
      needsRender:ready&&!existingMediaOk(e),animation,blockedReason};
  });
  const required=matrix.filter(x=>x.needsRender);
  // GitHub Actions rejects an empty matrix. Keep one no-op entry when every
  // available clip has already been rendered and independently accepted.
  console.log("matrix="+JSON.stringify(required.length?required:[matrix[0]]));
  console.log("allEntries="+JSON.stringify(matrix));
  console.log("renderCount="+required.length);
  const sparse=[
    "/scripts/","/package.json","/package-lock.json",
    "/public/vendor-spine-player-3.7.js","/public/vendor-spine-player-3.7.css",
    "/public/vendor-spine-player-3.8.js","/public/vendor-spine-player-3.8.css",
    "/library/index.json","/library_*/index.json",
    ...matrix.map(x=>"/"+x.previewPath+"/"),
  ];
  console.log("sparseCheckout<<SPINE_SPARSE_END");
  console.log([...new Set(sparse)].join(String.fromCharCode(10)));
  console.log("SPINE_SPARSE_END");
  console.error("AUDIT_REQUESTED_PREVIEWS="+matrix.length+" SOURCE_READY="+matrix.filter(x=>x.ready).length+
    " BLOCKED="+matrix.filter(x=>!x.ready).length);
}else if(action==="merge"){
  const selected=JSON.parse(process.env.REPAIR_IDS_JSON||"[]");
  if(selected.length!==requestedIds.length)throw new Error("Missing exact repair manifest");
  const base=path.resolve(root,"downloaded-latest10");
  const indexes=new Map(),summary={ready:0,failed:0,blocked:0};
  for(const item of selected){
    if(!latest.some(e=>e.id===item.id)) throw new Error("Untrusted repair entry");
    const entryInfo=latest.find(e=>e.id===item.id);
    const indexPath=path.join(root,entryInfo.basePath,"index.json");
    if(!indexes.has(indexPath)) indexes.set(indexPath,readIndex(root,entryInfo.basePath)||[]);
    const entries=indexes.get(indexPath);
    const record=entries.find(e=>e.id===item.id);
    if(!record)throw new Error("Index record disappeared before repair");
    const blocker=item.blockedReason||bundleBlocker(entryInfo,item.animation,record);
    if(blocker){
      record.webmStatus=blocker==="missing-animation-selection"
        ?"blocked-missing-animation-selection":"blocked-missing-source";
      record.previewStatus="blocked";
      record.previewError=blocker==="missing-animation-selection"
        ?"No exact animation was selected":"Incomplete skeleton / atlas / texture bundle";
      summary.blocked++;
      continue;
    }
    if(item.needsRender===false){
      if(existingMediaOk(entryInfo)){
        summary.ready++;
        continue;
      }
      record.webmStatus="failed";
      record.previewStatus="failed";
      record.previewError="Media previously marked ready but expected outputs are missing";
      summary.failed++;
      continue;
    }
    if(!Number.isSafeInteger(Number(item.slot))||Number(item.slot)<1)throw new Error("Invalid repair slot");
    const artifact=path.join(base,"latest10-"+Number(item.slot));
    const metaPath=path.join(artifact,"meta.json");
    let meta=null;
    try{meta=JSON.parse(fs.readFileSync(metaPath,"utf8"));}catch{}
    const names=["preview.webm","preview-medium.webm","preview-low.webm",
      "preview.webp","preview-medium.webp","preview-low.webp"];
    let complete=meta?.ok===true && meta?.selectedAnimationVerified===true && names.every(n=>
      fs.existsSync(path.join(artifact,n)) && fs.statSync(path.join(artifact,n)).size>128);
    let mainVideo=null;
    if(complete) {
      try {
        for(const name of ["preview.webm","preview-medium.webm","preview-low.webm"]) {
          const data=JSON.parse(execFileSync("ffprobe", [
            "-v","error","-count_frames","-select_streams","v:0",
            "-show_entries","stream=nb_read_frames,width,height:format=duration",
            "-of","json",path.join(artifact,name),
          ],{encoding:"utf8",timeout:30000}));
          const stream=data.streams?.[0],frames=Number(stream?.nb_read_frames),
            seconds=Number(data.format?.duration);
          if(!(seconds>=0.5&&frames>=8&&frames/seconds>=15&&stream?.width>0&&stream?.height>0))
            throw new Error("Video has too few real frames");
          if(name==="preview.webm")mainVideo={frames,seconds};
        }
      }catch{complete=false;}
    }
    if(!complete) {
      if(record.webmStatus==="ready" && record.webmPreview && record.webpPoster) {
        // Never replace an existing genuine clip with a failed higher-FPS retry.
        record.lastPreviewRetryError="New version failed frame-density acceptance; previous media retained";
        summary.ready++;
        continue;
      }
      record.webmStatus="failed";
      record.previewStatus="failed";
      record.previewError="Native preview render did not pass media acceptance";
      summary.failed++;
      continue;
    }
    const destination=path.resolve(root,entryInfo.previewPath);
    for(const name of names)fs.copyFileSync(path.join(artifact,name),path.join(destination,name));
    const prefix="https://spine-link.vercel.app/assets/"+entryInfo.previewPath.replace(/\\/g,"/")+"/";
    const animation=typeof record.defaultAnimation==="string"&&record.defaultAnimation.length
      ?record.defaultAnimation:String(item.animation||"");
    if(!animation){
      record.webmStatus="blocked-missing-animation-selection";
      record.previewStatus="blocked";
      record.previewError="No exact animation was selected";
      summary.blocked++;
      continue;
    }
    if(meta.selectedAnimationVerified!==true){
      record.webmStatus="failed";
      record.previewStatus="failed";
      record.previewError="Rendered animation did not match the exact selection";
      summary.failed++;
      continue;
    }
    const webm=prefix+"preview.webm",poster=prefix+"preview.webp";
    record.webmPreview=webm;
    record.webmPreviewMedium=prefix+"preview-medium.webm";
    record.webmPreviewLow=prefix+"preview-low.webm";
    record.thumbnailPoster=poster;
    record.webpPoster=poster;
    record.webpPosterMedium=prefix+"preview-medium.webp";
    record.webpPosterLow=prefix+"preview-low.webp";
    record.webmStatus="ready";
    record.previewStatus="ready";
    record.dispatchStatus="rendered";
    record.previewError="";
    const now=new Date().toISOString();
    record.webmGeneratedAt=now;
    record.posterGeneratedAt=now;
    if(animation) record.defaultAnimation=animation;
    if(Number(meta.width)>0)record.previewWidth=meta.width;
    if(Number(meta.height)>0)record.previewHeight=meta.height;
    if(mainVideo) {
      record.previewFrameCount=mainVideo.frames;
      record.previewDuration=mainVideo.seconds;
    } else if(Number(meta.animationDuration)>0)record.previewDuration=meta.animationDuration;
    record.lastPreviewRetryError="";
    const previous=record.allAnimationPreviews && typeof record.allAnimationPreviews==="object"
      ? record.allAnimationPreviews:{};
    if(animation) record.allAnimationPreviews={
      ...previous,
      [animation]:{
        ...(previous[animation]||{}),
        webmPreview:webm,webmPreviewMedium:record.webmPreviewMedium,
        webmPreviewLow:record.webmPreviewLow,
        webpPoster:poster,webpPosterMedium:record.webpPosterMedium,
        webpPosterLow:record.webpPosterLow,
      },
    };
    summary.ready++;
  }
  for(const [p,a] of indexes)fs.writeFileSync(p,JSON.stringify(a,null,2)+"\n");
  fs.writeFileSync(path.join(root,"preview-repair-summary.json"), JSON.stringify(summary));
  console.log("PREVIEW_REPAIR_RESULT="+JSON.stringify(summary));
}else throw new Error("Unsupported action");
