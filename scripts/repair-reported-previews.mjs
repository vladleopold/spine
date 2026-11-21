#!/usr/bin/env node
/**
 * Fail-closed repair for the 18 reported Spine previews plus the exact priority work.
 * Source filenames, image bytes and generated previews never appear in logs.
 */
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { listCollectionFolders, readIndex } from "./resolve-library.mjs";
import { choosePreviewAnimation } from "./preview-animation-choice.mjs";
import { inspectAtlasSourceBundle } from "./lib/atlas-source-integrity.mjs";
import { storedPreviewStatusAllowsReuse, resolveStoredPreviewMediaFiles } from "./lib/reported-preview-repair-status.mjs";

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
  "Spine-animation-2026-11-17T18-39-06-745Z",
  "Spine-animation-2026-11-17T18-45-14-132Z"
];
const requestedSet=new Set(requestedIds);
// One additional legacy record has a complete indexed media map but no
// previewStatus. Keep its identifier out of public workflow source/logs.
const additionalIdHashes=new Set([
  "58208d872bd596e521f4869b427fe7c48453d60c24a832fb4fb1199ec5e76193",
]);
const requestedCount=requestedIds.length+additionalIdHashes.size;
const idHash=id=>createHash("sha256").update(String(id||"")).digest("hex");
function resolveRequestedEntries() {
  const byId=new Map();
  for(const folder of listCollectionFolders(root)) {
    for(const entry of readIndex(root,folder)||[]) {
      const id=String(entry?.id||"");
      if(!requestedSet.has(id)&&!additionalIdHashes.has(idHash(id)))continue;
      if(byId.has(id))throw new Error('Duplicate work across archive collections');
      const defaultAnimation=choosePreviewAnimation([],entry.defaultAnimation);
      byId.set(id,{id,basePath:folder,previewPath:entry.previewPath||folder+'/'+id,
        at:Date.parse(entry.uploadedAt||0)||0,defaultAnimation});
    }
  }
  const missing=requestedIds.filter(id=>!byId.has(id));
  const missingHashes=[...additionalIdHashes].filter(hash=>![...byId.keys()].some(id=>idHash(id)===hash));
  if(missing.length||missingHashes.length)
    throw new Error('Requested Spine source records missing: '+(missing.length+missingHashes.length));
  const primary=requestedIds.map(id=>byId.get(id));
  const additional=[...byId.values()].filter(entry=>!requestedSet.has(entry.id))
    .sort((a,b)=>idHash(a.id).localeCompare(idHash(b.id)));
  return [...primary,...additional];
}
function bundleOk(entry) {
  const p=path.resolve(root,entry.previewPath);
  if(!p.startsWith(root+path.sep))return false;
  const record=(readIndex(root,entry.basePath)||[]).find(x=>x.id===entry.id);
  const indexedFiles=Array.isArray(record?.files)?record.files:[];
  const indexOnly=process.env.SPINE_REPAIR_INDEX_ONLY==="1";
  let files=[];
  if(indexOnly) files=indexedFiles;
  else {
    if(!fs.existsSync(p))return false;
    files=indexedFiles.filter(value=>{
      const rel=String(value||"").replace(/\\/g,"/");
      if(!rel||rel.startsWith("/")||rel.split("/").includes(".."))return false;
      const target=path.resolve(p,rel);
      if(!target.startsWith(p+path.sep))return false;
      try{return fs.statSync(target).isFile();}catch{return false;}
    });
  }
  const triad=files.some(f=>/\\.(json|skel)$/i.test(f)) &&
    files.some(f=>/\\.atlas(?:\\.txt|\\.docx)?$/i.test(f)) &&
    files.some(f=>/\\.(png|jpe?g|webp|dds)$/i.test(f));
  if(!triad)return false;
  // Indexed paths may be nested (legacy exports). The hydrated render job
  // checks every listed source file and every atlas page against real texture dimensions.
  if(indexOnly)return true;
  return inspectAtlasSourceBundle(p,files).complete;
}
const mediaNames=["preview.webm","preview-medium.webm","preview-low.webm",
  "preview.webp","preview-medium.webp","preview-low.webp"];
function existingMediaOk(entry,animation,allowFailedStatus=false){
  const collection=readIndex(root,entry.basePath)||[];
  const record=collection.find(x=>x.id===entry.id);
  const selected=choosePreviewAnimation([],animation);
  if(!storedPreviewStatusAllowsReuse(record,selected,{allowFailedStatus}))return false;
  const resolved=resolveStoredPreviewMediaFiles(entry,record,selected);
  if(!resolved)return false;
  const frames=Number(record?.previewFrameCount||0);
  const duration=Number(record?.previewDuration||0);
  if((frames>0&&frames<8)||(duration>0&&duration<0.5)||
     (frames>0&&duration>0&&frames/duration<15))return false;
  if(process.env.SPINE_REPAIR_INDEX_ONLY==="1")return true;
  const mediaPaths=Object.fromEntries(Object.entries(resolved.files).map(([key,relative])=>{
    const file=path.resolve(root,relative);
    if(!file.startsWith(root+path.sep))throw new Error("Unsafe indexed media path");
    return [key,file];
  }));
  if(!Object.values(mediaPaths).every(file=>{
    try{return fs.statSync(file).isFile()&&fs.statSync(file).size>128;}
    catch{return false;}
  }))return false;
  try{
    const probes={};
    for(const key of ["webmPreview","webmPreviewMedium","webmPreviewLow"]){
      const data=JSON.parse(execFileSync("ffprobe",[
        "-v","error","-count_frames","-select_streams","v:0",
        "-show_entries","stream=width,height,nb_read_frames:format=duration",
        "-of","json",mediaPaths[key],
      ],{encoding:"utf8",timeout:30000}));
      const stream=data.streams?.[0]||{};
      const item={width:Number(stream.width),height:Number(stream.height),
        frames:Number(stream.nb_read_frames),duration:Number(data.format?.duration)};
      if(!(item.width>0&&item.height>0&&item.frames>=8&&item.duration>=0.5&&item.frames/item.duration>=15))return false;
      probes[key]=item;
    }
    if(!(probes.webmPreviewMedium.width<probes.webmPreview.width&&
      probes.webmPreviewLow.width<probes.webmPreviewMedium.width))return false;
    for(const [videoKey,posterKey] of [
      ["webmPreview","webpPoster"],
      ["webmPreviewMedium","webpPosterMedium"],
      ["webmPreviewLow","webpPosterLow"],
    ]){
      execFileSync(process.execPath,[path.join(root,"scripts/verify-preview-motion.mjs"),
        mediaPaths[videoKey]],{stdio:"ignore",timeout:120000});
      execFileSync(process.execPath,[path.join(root,"scripts/verify-poster-first-frame.mjs"),
        mediaPaths[videoKey],mediaPaths[posterKey]],{stdio:"ignore",timeout:60000});
    }
    return true;
  }catch{return false;}
}
const action=process.argv[2]||"matrix";
const latest=resolveRequestedEntries();
if(action==="matrix"){
  if(latest.length!==requestedCount)throw new Error("Cannot find all requested reported entries");
  const matrix=latest.map((e,repairSlot)=>{
    const sourceReady=bundleOk(e);
    const animation=choosePreviewAnimation([],e.defaultAnimation);
    const ready=sourceReady&&Boolean(animation);
    const rel=String(e.previewPath).replace(/\\/g,"/");
    const legacyRootPath=rel===e.id&&!rel.includes("/")&&!rel.includes("\\");
    if((!rel.startsWith(e.basePath+"/")&&!legacyRootPath)||rel.startsWith("/")||
      rel.includes("\\")||rel.split("/").includes(".."))
      throw new Error("Unsafe preview path");
    return {repairSlot,id:e.id,basePath:e.basePath,previewPath:rel,ready,
      needsRender:ready&&!existingMediaOk(e,animation),animation,
      blockedReason:!sourceReady?"MISSING_SOURCE_BUNDLE":!animation?"MISSING_DEFAULT_ANIMATION":""};
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
  ];
  console.log("sparseCheckout<<SPINE_SPARSE_END");
  console.log([...new Set(sparse)].join(String.fromCharCode(10)));
  console.log("SPINE_SPARSE_END");
  console.error("AUDIT_REQUESTED_PREVIEWS="+matrix.length+
    " SOURCE_READY="+matrix.filter(x=>x.ready).length+
    " BLOCKED_SOURCE_BUNDLE="+matrix.filter(x=>x.blockedReason==="MISSING_SOURCE_BUNDLE").length+
    " BLOCKED_MISSING_ANIMATION="+matrix.filter(x=>x.blockedReason==="MISSING_DEFAULT_ANIMATION").length+
    " NEEDS_RENDER="+required.length+
    " EXISTING_READY="+matrix.filter(x=>x.ready&&!x.needsRender).length);
}else if(action==="merge"){
  const selected=JSON.parse(process.env.REPAIR_IDS_JSON||"[]");
  if(selected.length!==requestedCount)throw new Error("Missing exact repair manifest");
  const base=path.resolve(root,"downloaded-reported20");
  const indexes=new Map(),summary={ready:0,failed:0,blocked:0},seenSlots=new Set();
  for(const item of selected){
    if(!Number.isInteger(item.repairSlot)||item.repairSlot<0||item.repairSlot>=requestedCount||seenSlots.has(item.repairSlot))
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
    const artifact=path.join(base,"reported20-"+item.repairSlot);
    const metaPath=path.join(artifact,"meta.json");
    let meta=null;
    try{meta=JSON.parse(fs.readFileSync(metaPath,"utf8"));}catch{}
    if(meta?.existingMediaVerified===true){
      if(existingMediaOk(entryInfo,selectedAnimation,true)){
        record.webmStatus="ready";
        record.previewStatus="ready";
        record.previewError="";
        record.lastPreviewRetryError="";
        summary.ready++;
      }else{
        record.webmStatus="failed";
        record.previewStatus="failed";
        record.previewError="Stored same-animation media failed independent verification";
        summary.failed++;
      }
      continue;
    }
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
        for(const suffix of ["","-medium","-low"]){
          execFileSync(process.execPath,[path.join(root,"scripts/verify-preview-motion.mjs"),
            path.join(artifact,"preview"+suffix+".webm")],{stdio:"ignore",timeout:120000});
          execFileSync(process.execPath,[path.join(root,"scripts/verify-poster-first-frame.mjs"),
            path.join(artifact,"preview"+suffix+".webm"),
            path.join(artifact,"preview"+suffix+".webp")],{stdio:"ignore",timeout:60000});
        }
      }catch{complete=false;}
    }
    if(!complete) {
      if(existingMediaOk(entryInfo,selectedAnimation,true)) {
        // A failed stored status can be repaired only after the old files pass
        // exact-animation, three-rendition, motion and poster verification.
        record.webmStatus="ready";
        record.previewStatus="ready";
        record.previewError="";
        record.lastPreviewRetryError="New render failed; previous exact-animation media passed independent verification";
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
}else if(action==="validate-existing"){
  const entryId=process.env.ENTRY_ID||"";
  const entry=latest.find(x=>x.id===entryId);
  const selected=choosePreviewAnimation([],process.env.ENTRY_ANIMATION||"");
  const output=process.env.OUTPUT_META||"";
  if(!entry||!output||!selected||selected!==entry.defaultAnimation||!bundleOk(entry)||
    !existingMediaOk(entry,selected,true)){
    console.log("EXISTING_MEDIA_REJECTED");
    process.exitCode=1;
  }else{
    fs.mkdirSync(path.dirname(output),{recursive:true});
    fs.writeFileSync(output,JSON.stringify({
      ok:true,animationMatches:true,animation:selected,existingMediaVerified:true,
    }));
    console.log("EXISTING_MEDIA_REVALIDATED");
  }
}else throw new Error("Unsupported action");
