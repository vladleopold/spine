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
import { choosePreviewAnimation } from "./preview-animation-choice.mjs";
import { applyFrozenRenderSlots, previewManifestDigest, preparePreviewManifest, preparePreviewSlot, writePreparedPreviewEnvironment } from "./lib/preview-manifest-transport.mjs";

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
      const defaultAnimation=choosePreviewAnimation([],entry.defaultAnimation);
      byId.set(entry.id,{id:entry.id,basePath:folder,previewPath:entry.previewPath||folder+'/'+entry.id,
        at:Date.parse(entry.uploadedAt||0)||0,defaultAnimation});
    }
  }
  const missing=requestedIds.filter(id=>!byId.has(id));
  if(missing.length)throw new Error('Requested Spine works missing from source indexes: '+missing.length);
  return requestedIds.map(id=>byId.get(id));
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
  const selected=choosePreviewAnimation([],animation);
  if(record?.webmStatus!=="ready"||!selected||choosePreviewAnimation([],record?.defaultAnimation)!==selected)return false;
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
const latest=newestTen();
function buildMatrix(){
  if(latest.length!==requestedIds.length)throw new Error("Cannot find all reported entries");
  return latest.map((e,repairSlot)=>{
    const sourceReady=bundleOk(e);
    const animation=choosePreviewAnimation([],e.defaultAnimation);
    const ready=sourceReady&&Boolean(animation);
    const rel=String(e.previewPath).replace(/\\/g,"/");
    if(!rel.startsWith(e.basePath+"/")||rel.split("/").includes(".."))
      throw new Error("Unsafe preview path");
    return {repairSlot,id:e.id,basePath:e.basePath,previewPath:rel,ready,
      needsRender:ready&&!existingMediaOk(e,animation),animation,
      blockedReason:!sourceReady?"MISSING_SOURCE_BUNDLE":!animation?"MISSING_DEFAULT_ANIMATION":""};
  });
}
const matrix=buildMatrix();
if(action==="matrix"){
  const required=matrix.filter(x=>x.needsRender);
  const renderSlots=required.map(x=>x.repairSlot);
  const renderMatrix=renderSlots.length
    ? renderSlots.map(repairSlot=>({repairSlot,needsRender:true}))
    : [{repairSlot:0,needsRender:false}];
  console.log("matrix="+JSON.stringify(renderMatrix));
  console.log("renderSlots="+JSON.stringify(renderSlots));
  console.log("manifestSha256="+previewManifestDigest(matrix));
  console.log("renderCount="+required.length);
  console.error("AUDIT_REQUESTED_PREVIEWS="+matrix.length+
    " SOURCE_READY="+matrix.filter(x=>x.ready).length+
    " BLOCKED_SOURCE_BUNDLE="+matrix.filter(x=>x.blockedReason==="MISSING_SOURCE_BUNDLE").length+
    " BLOCKED_MISSING_ANIMATION="+matrix.filter(x=>x.blockedReason==="MISSING_DEFAULT_ANIMATION").length+
    " NEEDS_RENDER="+required.length+
    " EXISTING_READY="+matrix.filter(x=>x.ready&&!x.needsRender).length);
}else if(action==="prepare-manifest"||action==="prepare-slot"){
  const frozen=applyFrozenRenderSlots(matrix,process.env.RENDER_SLOTS_JSON||"[]");
  const expected=process.env.EXPECTED_MANIFEST_SHA256||"";
  const prepared=action==="prepare-manifest"
    ? preparePreviewManifest(frozen,expected)
    : preparePreviewSlot(frozen,process.env.REPAIR_SLOT,expected);
  writePreparedPreviewEnvironment(prepared,process.env.GITHUB_ENV);
  console.log(action==="prepare-manifest"?"REPORTED_PREVIEW_MANIFEST_PREPARED":"REPORTED_PREVIEW_SLOT_PREPARED");
}else if(action==="merge"){
  const frozen=applyFrozenRenderSlots(matrix,process.env.RENDER_SLOTS_JSON||"[]");
  const expected=process.env.EXPECTED_MANIFEST_SHA256||"";
  if(previewManifestDigest(frozen)!==expected)
    throw new Error("Frozen preview manifest changed before publish");
  const selected=JSON.parse(process.env.REPAIR_IDS_JSON||"[]");
  if(previewManifestDigest(selected)!==expected)
    throw new Error("Published preview manifest does not match the frozen snapshot");
  if(selected.length!==requestedIds.length)throw new Error("Missing exact repair manifest");
  const base=path.resolve(root,"downloaded-reported18");
  const indexes=new Map(),summary={ready:0,failed:0,blocked:0},seenSlots=new Set();
  for(const item of selected){
    if(!Number.isInteger(item.repairSlot)||item.repairSlot<0||item.repairSlot>=requestedIds.length||seenSlots.has(item.repairSlot))
      throw new Error("Invalid artifact slot");
    seenSlots.add(item.repairSlot);
    if(!latest.some(e=>e.id===item.id)) throw new Error("Untrusted repair entry");
    const entryInfo=latest.find(e=>e.id===item.id);
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
    const selectedAnimation=choosePreviewAnimation([],item.animation);
    const indexedAnimation=choosePreviewAnimation([],record.defaultAnimation);
    if(!selectedAnimation){
      record.webmStatus="blocked-missing-animation";
      record.previewStatus="blocked";
      record.previewError="No exact selected/default animation is available";
      summary.blocked++;
      continue;
    }
    if(selectedAnimation!==indexedAnimation){
      record.webmStatus="blocked-animation-selection-mismatch";
      record.previewStatus="blocked";
      record.previewError="Selected animation does not match the unchanged index default";
      summary.blocked++;
      continue;
    }
    if(item.needsRender===false){
      if(existingMediaOk(entryInfo,selectedAnimation)){
        summary.ready++;
        continue;
      }
      record.webmStatus="failed";
      record.previewStatus="failed";
      record.previewError="Media previously marked ready but expected outputs are missing";
      summary.failed++;
      continue;
    }
    const artifact=path.join(base,"reported18-"+item.repairSlot);
    const metaPath=path.join(artifact,"meta.json");
    let meta=null;
    try{meta=JSON.parse(fs.readFileSync(metaPath,"utf8"));}catch{}
    const names=["preview.webm","preview-medium.webm","preview-low.webm",
      "preview.webp","preview-medium.webp","preview-low.webp"];
    let complete=meta?.ok===true && meta?.animationMatches===true &&
      choosePreviewAnimation([],meta?.animation)===selectedAnimation && names.every(n=>
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
    const animation=selectedAnimation;
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
