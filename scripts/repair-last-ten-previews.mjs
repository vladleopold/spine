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
import { previewSourceFingerprint, validateFrozenRepairRecord } from "./repair-manifest-guard.mjs";

const root=process.cwd();
// Work names include wolf, cherry, characters and user-defined prefixes.
// Filtering only "Spine-animation-*" silently excluded genuinely new uploads.
const idPattern=/^[a-z0-9][a-z0-9._-]{0,200}$/i;
function newestTen() {
  const entries=[];
  for(const folder of listCollectionFolders(root)) {
    for(const entry of readIndex(root,folder)||[]) {
      if(!idPattern.test(entry?.id||""))continue;
      const timestamp=Date.parse(entry.uploadedAt||"");
      if(!Number.isFinite(timestamp))continue;
      entries.push({id:entry.id,basePath:folder,previewPath:entry.previewPath||folder+"/"+entry.id,
        at:timestamp});
    }
  }
  return entries.sort((a,b)=>b.at-a.at).slice(0,10);
}
function bundleOk(entry) {
  const p=path.resolve(root,entry.previewPath);
  if(!p.startsWith(root+path.sep))return false;
  let files=[];
  try{files=fs.readdirSync(p).filter(f=>fs.statSync(path.join(p,f)).isFile());}
  catch{
    // Inventory checks indexes only; the render job validates actual files.
    files=(readIndex(root,entry.basePath)||[]).find(x=>x.id===entry.id)?.files||[];
  }
  return files.some(f=>/\.(json|skel)$/i.test(f)) &&
    files.some(f=>/\.atlas(?:\.txt|\.docx)?$/i.test(f)) &&
    files.some(f=>/\.(png|jpe?g|webp|dds)$/i.test(f));
}
const mediaNames=["preview.webm","preview-medium.webm","preview-low.webm",
  "preview.webp","preview-medium.webp","preview-low.webp"];
function existingMediaOk(entry,animation){
  const collection=readIndex(root,entry.basePath)||[];
  const record=collection.find(x=>x.id===entry.id);
  if(record?.webmStatus!=="ready")return false;
  const selected=String(animation||record?.defaultAnimation||"").trim();
  if(!selected||selected!==String(record?.defaultAnimation||"").trim())return false;
  // A previously published Urka clip was decoded as only 12 frames over
  // 1.82 seconds. Require real frame-density evidence before treating it as
  // an accepted final video; leave older previews intact during retries.
  const f=Number(record?.previewFrameCount||0);
  const duration=Number(record?.previewDuration||0);
  if(f>0&&duration>0&&f/duration<15)return false;
  if(entry.id==="Spine-animation-2026-11-17T18-39-06-745Z"&&!(f>0&&duration>0&&f/duration>=15))return false;
  if(process.env.SPINE_REPAIR_INDEX_ONLY==="1")
    return Boolean(record?.webmPreview&&record?.webpPoster);
  return mediaNames.every(name=>{
    try{return fs.statSync(path.join(root,entry.previewPath,name)).size>128;}
    catch{return false;}
  });
}
const action=process.argv[2]||"matrix";
const latest=action==="matrix"?newestTen():[];
if(action==="matrix"){
  if(latest.length!==10)throw new Error("Cannot find 10 recent entries");
  const matrix=latest.map(e=>{
    const record=(readIndex(root,e.basePath)||[]).find(x=>x.id===e.id);
    const animation=typeof record?.defaultAnimation==="string"?record.defaultAnimation.trim():"";
    const sourceReady=bundleOk(e);
    const ready=Boolean(animation)&&sourceReady;
    const rel=String(e.previewPath).replace(/\\/g,"/");
    if(!rel.startsWith(e.basePath+"/")||rel.split("/").includes(".."))
      throw new Error("Unsafe preview path");
    return {id:e.id,basePath:e.basePath,previewPath:rel,
      uploadedAt:e.at,
      sourceFingerprint:previewSourceFingerprint(record),
      ready,needsRender:ready&&!existingMediaOk(e,animation),
      animation,
      blockedReason:!animation?"MISSING_DEFAULT_ANIMATION":!sourceReady?"MISSING_SOURCE_TRIAD":""};
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
  console.error("AUDIT_LAST10="+matrix.length+" SOURCE_READY="+matrix.filter(x=>x.ready).length+
    " BLOCKED="+matrix.filter(x=>!x.ready).length);
}else if(action==="merge"){
  const selected=JSON.parse(process.env.REPAIR_IDS_JSON||"[]");
  if(selected.length!==10)throw new Error("Missing exact repair manifest");
  const base=path.resolve(root,"downloaded-latest10");
  const indexes=new Map(),summary={ready:0,failed:0,blocked:0};
  const folders=listCollectionFolders(root);
  const seen=new Set();
  for(const item of selected){
    const entryInfo=validateFrozenRepairRecord(root,item,folders,readIndex);
    const uniqueKey=entryInfo.basePath+"/"+entryInfo.id;
    if(seen.has(uniqueKey))throw new Error("Duplicate repair entry");
    seen.add(uniqueKey);
    const indexPath=path.join(root,entryInfo.basePath,"index.json");
    if(!indexes.has(indexPath)) indexes.set(indexPath,readIndex(root,entryInfo.basePath)||[]);
    const entries=indexes.get(indexPath);
    const record=entries.find(e=>e.id===item.id);
    if(!record)throw new Error("Index record disappeared before repair");
    if(!bundleOk(entryInfo)){
      record.webmStatus="blocked-missing-source";
      record.previewStatus="blocked";
      record.previewError="Incomplete skeleton / atlas / texture bundle";
      summary.blocked++;
      continue;
    }
    const expectedAnimation=String(record.defaultAnimation||"").trim();
    if(!expectedAnimation||String(item.animation||"").trim()!==expectedAnimation){
      record.webmStatus="blocked-missing-animation-selection";
      record.previewStatus="blocked";
      record.previewError="No exact default animation is selected; preview rendering will not guess or substitute an animation";
      summary.blocked++;
      continue;
    }
    if(item.needsRender===false){
      if(existingMediaOk(entryInfo,expectedAnimation)){
        summary.ready++;
        continue;
      }
      record.webmStatus="failed";
      record.previewStatus="failed";
      record.previewError="Media previously marked ready but expected outputs are missing";
      summary.failed++;
      continue;
    }
    const artifact=path.join(base,"latest10-"+item.id);
    const metaPath=path.join(artifact,"meta.json");
    let meta=null;
    try{meta=JSON.parse(fs.readFileSync(metaPath,"utf8"));}catch{}
    const names=["preview.webm","preview-medium.webm","preview-low.webm",
      "preview.webp","preview-medium.webp","preview-low.webp"];
    let complete=meta?.ok===true && String(meta?.animation||"").trim()===expectedAnimation && names.every(n=>
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
      if(record.webmStatus==="ready" && record.webmPreview && record.webpPoster &&
         existingMediaOk(entryInfo,expectedAnimation)) {
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
    const animation=expectedAnimation;
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
    if(Array.isArray(meta.animations)&&meta.animations.length)record.animations=meta.animations;

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
