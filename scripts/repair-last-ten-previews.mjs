#!/usr/bin/env node
/**
 * Fail-closed 10-most-recent Spine preview repair.
 * Runs only on authenticated private Github Actions workers.
 * Source filenames, image bytes and generated previews never appear in logs.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { fingerprintPreviewMedia, selectedPreviewTiers } from "./lib/preview-media-validation.mjs";
import { listCollectionFolders, readIndex } from "./resolve-library.mjs";
import { choosePreviewAnimation } from "./preview-animation-choice.mjs";
import { previewSourceFingerprint, validateFrozenRepairRecord } from "./repair-manifest-guard.mjs";
import { inspectAtlasSourceBundle } from "./lib/atlas-source-integrity.mjs";
import { previewManifestMaskCommands, previewManifestEnvBlock } from "./lib/preview-manifest-redaction.mjs";

const root=process.cwd();
// Work names include wolf, cherry, characters and user-defined prefixes.
// Filtering only "Spine-animation-*" silently excluded genuinely new uploads.
const idPattern=/^[a-z0-9][a-z0-9._-]{0,200}$/i;
function newestTen() {
  const entries=[];
  for(const folder of listCollectionFolders(root)) {
    for(const entry of readIndex(root,folder)||[]) {
      if(!idPattern.test(entry?.id||"") || entry.testOnly===true || entry.hiddenFromPublicLibrary===true)continue;
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
function sourceIssue(entry){
  const p=path.resolve(root,entry.previewPath);
  if(!p.startsWith(root+path.sep))return "UNSAFE_PREVIEW_PATH";
  try{
    const files=fs.readdirSync(p).filter(name=>fs.statSync(path.join(p,name)).isFile());
    return inspectAtlasSourceBundle(p,files).reason;
  }catch{return "MISSING_SOURCE_TRIAD";}
}
const mediaNames=["preview.webm","preview-medium.webm","preview-low.webm",
  "preview.webp","preview-medium.webp","preview-low.webp"];
function existingMediaOk(entry,animation){
  const collection=readIndex(root,entry.basePath)||[];
  const record=collection.find(x=>x.id===entry.id);
  if(record?.webmStatus!=="ready")return false;
  const selected=choosePreviewAnimation([],typeof animation==="string"?animation:record?.defaultAnimation);
  if(!selected||selected!==choosePreviewAnimation([],record?.defaultAnimation))return false;
  // A previously published Urka clip was decoded as only 12 frames over
  // 1.82 seconds. Require real frame-density evidence before treating it as
  // an accepted final video; leave older previews intact during retries.
  const f=Number(record?.previewFrameCount||0);
  const duration=Number(record?.previewDuration||0);
  if(f>0&&duration>0&&f/duration<15)return false;
  if(entry.id==="Spine-animation-2026-11-17T18-39-06-745Z"&&!(f>0&&duration>0&&f/duration>=15))return false;
  if(process.env.SPINE_REPAIR_INDEX_ONLY==="1") {
    // An index-only inventory has no media bytes to probe or decode. Force the
    // downstream worker to verify the exact WebM/WebP pair before accepting it.
    return false;
  }
  return mediaNames.every(name=>{
    try{return fs.statSync(path.join(root,entry.previewPath,name)).size>128;}
    catch{return false;}
  });
}
function existingMediaMatchesVerification(entryInfo, record, animation, meta) {
  const animationHash=createHash("sha256").update(animation).digest("hex");
  if(meta?.ok!==true || meta?.existingVerified!==true || meta?.animationMatches!==true ||
     meta?.animationHash!==animationHash || meta?.sourceFingerprint!==previewSourceFingerprint(record) || Number(meta?.tierCount)!==3 ||
     typeof meta?.mediaFingerprint!=="string" || !meta.mediaFingerprint)return false;
  const tiers=selectedPreviewTiers(record,animation);
  if(!tiers || tiers.length!==3)return false;
  const media=[];
  try{
    for(const tier of tiers){
      media.push([tier.webmFile,fs.readFileSync(path.join(root,entryInfo.previewPath,tier.webmFile))]);
      media.push([tier.posterFile,fs.readFileSync(path.join(root,entryInfo.previewPath,tier.posterFile))]);
    }
  }catch{return false;}
  return fingerprintPreviewMedia(media)===meta.mediaFingerprint;
}


function manifestFor(entries=newestTen()) {
  return entries.map((entry,repairSlot)=>{
    const record=(readIndex(root,entry.basePath)||[]).find(x=>x.id===entry.id);
    const animation=choosePreviewAnimation([],record?.defaultAnimation);
    const sourceFingerprint=previewSourceFingerprint(record);
    const animationHash=createHash("sha256").update(animation).digest("hex");
    return {repairSlot,id:entry.id,basePath:entry.basePath,previewPath:entry.previewPath,
      uploadedAt:entry.at,sourceFingerprint,animation,animationHash};
  });
}
function appendMaskedEnv(values) {
  if(!process.env.GITHUB_ENV)throw new Error("Missing GitHub environment file");
  const raw=JSON.stringify(values);
  process.stdout.write(previewManifestMaskCommands(values,raw,values));
  fs.appendFileSync(process.env.GITHUB_ENV,previewManifestEnvBlock(values),"utf8");
}
function prepareSlot(slot) {
  if(!Number.isInteger(slot)||slot<0||slot>=10)throw new Error("Invalid latest-10 repair slot");
  const item=manifestFor()[slot];
  if(!item||!item.animation)throw new Error("Selected latest-10 entry is not renderable");
  if(process.env.SOURCE_FINGERPRINT&&process.env.SOURCE_FINGERPRINT!==item.sourceFingerprint)
    throw new Error("Source fingerprint changed since inventory");
  if(process.env.ANIMATION_HASH&&process.env.ANIMATION_HASH!==item.animationHash)
    throw new Error("Animation identity changed since inventory");
  const values={ENTRY_ID:item.id,ENTRY_BASE_PATH:item.basePath,ENTRY_PATH:item.previewPath,
    PREVIEW_PATH:item.previewPath,ENTRY_ANIMATION:item.animation,
    SOURCE_FINGERPRINT:item.sourceFingerprint,ANIMATION_HASH:item.animationHash};
  appendMaskedEnv(values);
  if(process.env.SPINE_PREPARE_SKIP_HYDRATE!=="1")
    execFileSync("git",["sparse-checkout","add",item.previewPath+"/"],{stdio:"ignore"});
  console.log("PREVIEW_METADATA_MASKED");
}
function prepareAll() {
  const manifest=manifestFor();
  const raw=JSON.stringify(manifest);
  if(!process.env.GITHUB_ENV)throw new Error("Missing GitHub environment file");
  process.stdout.write(previewManifestMaskCommands(manifest,raw,{}));
  fs.appendFileSync(process.env.GITHUB_ENV,previewManifestEnvBlock({REPAIR_IDS_JSON:raw}),"utf8");
  if(process.env.SPINE_PREPARE_HYDRATE==="1") {
    for(const item of manifest) {
      const rel=String(item.previewPath||"").replace(/\\\\/g,"/");
      if(!rel.startsWith(String(item.basePath||"")+"/")||rel.split("/").includes(".."))
        throw new Error("Unsafe source path in repair manifest");
      execFileSync("git",["sparse-checkout","add",rel+"/"],{stdio:"ignore"});
    }
  }
  console.log("PREVIEW_METADATA_MASKED");
}

const action=process.argv[2]||"matrix";
const latest=action==="matrix"?newestTen():[];
if(action==="matrix"){
  if(latest.length!==10)throw new Error("Cannot find 10 recent entries");
  const matrix=latest.map((e,repairSlot)=>{
    const record=(readIndex(root,e.basePath)||[]).find(x=>x.id===e.id);
    const animation=choosePreviewAnimation([],record?.defaultAnimation);
    const incompatible=record?.webmStatus==="blocked-incompatible-source-version";
    const sourceReady=bundleOk(e);
    const ready=Boolean(animation)&&sourceReady&&!incompatible;
    const rel=String(e.previewPath).replace(/\\/g,"/");
    if(!rel.startsWith(e.basePath+"/")||rel.split("/").includes(".."))
      throw new Error("Unsafe preview path");
    return {repairSlot,id:e.id,basePath:e.basePath,previewPath:rel,
      uploadedAt:e.at,
      sourceFingerprint:previewSourceFingerprint(record),
      animationHash:createHash("sha256").update(animation).digest("hex"),
      ready,needsRender:ready&&!existingMediaOk(e,animation),
      animation,
      blockedReason:incompatible?"INCOMPATIBLE_SOURCE_VERSION":!animation?"MISSING_DEFAULT_ANIMATION":!sourceReady?"MISSING_SOURCE_TRIAD":""};
  });
  const required=matrix.filter(x=>x.ready);
  // GitHub Actions rejects an empty matrix. Keep one no-op entry when every
  // available clip has already been rendered and independently accepted.
  console.log("matrix="+JSON.stringify(required.length?required:[matrix[0]]));
  console.log("allEntries="+JSON.stringify(matrix));
  console.log("renderCount="+required.length);
  console.error("AUDIT_LAST10="+matrix.length+" SOURCE_READY="+matrix.filter(x=>x.ready).length+
    " BLOCKED="+matrix.filter(x=>!x.ready).length);
}else if(action==="prepare"){
  prepareSlot(Number(process.argv[3]));
}else if(action==="prepare-all"){
  prepareAll();
}else if(action==="merge"){
  const selected=JSON.parse(process.env.REPAIR_IDS_JSON||"[]");
  if(selected.length!==10)throw new Error("Missing exact repair manifest");
  const base=path.resolve(root,"downloaded-latest10");
  const indexes=new Map(),summary={ready:0,failed:0,blocked:0};
  const folders=listCollectionFolders(root);
  const seen=new Set(),slots=new Set();
  for(const item of selected){
    if(!Number.isInteger(item.repairSlot)||item.repairSlot<0||item.repairSlot>=10||slots.has(item.repairSlot))
      throw new Error("Invalid artifact slot");
    slots.add(item.repairSlot);
    const entryInfo=validateFrozenRepairRecord(root,item,folders,readIndex);
    const uniqueKey=entryInfo.basePath+"/"+entryInfo.id;
    if(seen.has(uniqueKey))throw new Error("Duplicate repair entry");
    seen.add(uniqueKey);
    const indexPath=path.join(root,entryInfo.basePath,"index.json");
    if(!indexes.has(indexPath)) indexes.set(indexPath,readIndex(root,entryInfo.basePath)||[]);
    const entries=indexes.get(indexPath);
    const record=entries.find(e=>e.id===item.id);
    if(!record)throw new Error("Index record disappeared before repair");
    const sourceProblem=sourceIssue(entryInfo);
    if(sourceProblem==="UNSUPPORTED_SPINE_EXPORT_3_8_75"){
      record.webmStatus="blocked-incompatible-source-version";
      record.previewStatus="blocked";
      record.previewError="Spine 3.8.75 export is rejected by official runtimes; re-export from the original Spine project required";
      summary.blocked++;
      continue;
    }
    if(!bundleOk(entryInfo)){
      record.webmStatus="blocked-missing-source";
      record.previewStatus="blocked";
      record.previewError="Incomplete skeleton / atlas / texture bundle";
      summary.blocked++;
      continue;
    }
    const expectedAnimation=choosePreviewAnimation([],record.defaultAnimation);
    if(!expectedAnimation||choosePreviewAnimation([],item.animation)!==expectedAnimation){
      record.webmStatus="blocked-missing-animation-selection";
      record.previewStatus="blocked";
      record.previewError="No explicit default animation is selected; existing media cannot be attributed to an exact source animation";
      summary.blocked++;
      continue;
    }
    const artifact=path.join(base,"latest10-"+item.repairSlot);
    let existingMeta=null;
    try{existingMeta=JSON.parse(fs.readFileSync(path.join(artifact,"existing-media.json"),"utf8"));}catch{}
    if(existingMediaMatchesVerification(entryInfo,record,expectedAnimation,existingMeta)){
      summary.ready++;
      continue;
    }
    const metaPath=path.join(artifact,"meta.json");
    let meta=null;
    try{meta=JSON.parse(fs.readFileSync(metaPath,"utf8"));}catch{}
    const expectedAnimationHash=createHash("sha256").update(expectedAnimation).digest("hex");
    const names=["preview.webm","preview-medium.webm","preview-low.webm",
      "preview.webp","preview-medium.webp","preview-low.webp"];
    let complete=meta?.ok===true && meta?.animationMatches===true && meta?.animationHash===expectedAnimationHash && meta?.sourceFingerprint===item.sourceFingerprint && names.every(n=>
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
      record.webmStatus="failed";
      record.previewStatus="failed";
      record.previewError="Native preview render did not pass media acceptance; existing bytes were not independently verified";
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
