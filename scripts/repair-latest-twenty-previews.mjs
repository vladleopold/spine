#!/usr/bin/env node
/**
 * Fail-closed 20-most-recent Spine preview repair.
 * Runs only on authenticated private Github Actions workers.
 * Source filenames, image bytes and generated previews never appear in logs.
 */
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { listCollectionFolders, readIndex } from "./resolve-library.mjs";
import { choosePreviewAnimation } from "./preview-animation-choice.mjs";
import { previewSourceFingerprint, validateFrozenRepairRecord } from "./repair-manifest-guard.mjs";
import { inspectAtlasSourceBundle } from "./lib/atlas-source-integrity.mjs";
import { generateFirstFrameWebp } from "./lib/first-frame-poster.mjs";

const root=process.cwd();
const PREVIEW_RENDERER_REVISION="auto-track-recovery-v3";
const repairLimit=Number(process.env.SPINE_REPAIR_LIMIT||20);
if(!Number.isInteger(repairLimit)||repairLimit<1||repairLimit>50)throw new Error('SPINE_REPAIR_LIMIT must be an integer from 1 to 50');
// Work names include wolf, cherry, characters and user-defined prefixes.
// Filtering only "Spine-animation-*" silently excluded genuinely new uploads.
const idPattern=/^[a-z0-9][a-z0-9._-]{0,200}$/i;
function newestEntries() {
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
  return entries.sort((a,b)=>b.at-a.at).slice(0,repairLimit);
}
function inspectSourceTree(entry){
  const rootPath=path.resolve(root,entry.previewPath);
  if(!rootPath.startsWith(root+path.sep))return {complete:false,reason:'UNSAFE_PREVIEW_PATH'};
  let bestReason='MISSING_SOURCE_TRIAD',foundTriad=false;
  const priority=['UNSUPPORTED_SPINE_EXPORT_3_8_75','ATLAS_PAGE_SOURCE_MISSING',
    'ATLAS_SOURCE_UNREADABLE','ATLAS_PAGE_INVENTORY_UNKNOWN','MISSING_SOURCE_TRIAD'];
  function walk(directory,depth=0){
    if(depth>6)return null;
    let items=[];
    try{items=fs.readdirSync(directory,{withFileTypes:true});}catch{return null;}
    const files=items.filter(item=>item.isFile()).map(item=>item.name);
    const triad=files.some(name=>/\.(json|skel)$/i.test(name))&&
      files.some(name=>/\.atlas(?:\.txt|\.docx)?$/i.test(name))&&
      files.some(name=>/\.(png|jpe?g|webp|dds)$/i.test(name));
    if(triad){
      foundTriad=true;
      const result=inspectAtlasSourceBundle(directory,files);
      if(result.complete)return {complete:true,reason:'COMPLETE'};
      if(priority.indexOf(result.reason)<priority.indexOf(bestReason))bestReason=result.reason;
    }
    for(const item of items){
      if(item.isDirectory()&&!item.name.endsWith('.__chunks')){
        const result=walk(path.join(directory,item.name),depth+1);
        if(result?.complete)return result;
      }
    }
    return null;
  }
  try{
    const result=walk(rootPath);
    if(result?.complete)return result;
  }catch{}
  return {complete:false,reason:foundTriad?bestReason:'MISSING_SOURCE_TRIAD'};
}
function sourceIssue(entry){
  return inspectSourceTree(entry).reason;
}
function readSourceAnimationNames(entry, record) {
  const directory=path.resolve(root,entry.previewPath);
  if(!directory.startsWith(root+path.sep))return [];
  const files=[];
  function walk(current,depth=0){
    if(depth>6)return;
    let items=[];
    try{items=fs.readdirSync(current,{withFileTypes:true});}catch{return;}
    for(const item of items){
      const full=path.join(current,item.name);
      if(item.isDirectory()&&!item.name.endsWith('.__chunks'))walk(full,depth+1);
      else if(item.isFile()&&/\.json$/i.test(item.name))files.push(full);
    }
  }
  walk(directory);
  const requested=path.basename(String(record?.skeleton||record?.skeletonFile||''));
  const requestedStem=requested.replace(/\.(?:json|skel)$/i,'').toLowerCase();
  files.sort((a,b)=>{
    const score=file=>{
      const name=path.basename(file);
      const stem=name.replace(/\.(?:json|skel)$/i,'').toLowerCase();
      return name===requested?0:(requestedStem&&stem===requestedStem?1:2);
    };
    return score(a)-score(b);
  });
  for(const file of files){
    try{
      const data=JSON.parse(fs.readFileSync(file,'utf8'));
      if(Array.isArray(data?.bones)&&data.animations&&typeof data.animations==='object'){
        const names=Object.keys(data.animations);
        const moving=names.filter(name=>{
          const times=new Set();
          const walk=value=>{
            if(!value||typeof value!=='object')return;
            if(Array.isArray(value)){for(const item of value)walk(item);return;}
            if(typeof value.time==='number')times.add(value.time);
            for(const key of Object.keys(value))walk(value[key]);
          };
          walk(data.animations[name]);
          return times.size>1;
        });
        return moving.length?moving:names;
      }
    }catch{}
  }
  return Array.isArray(record?.animations)
    ? record.animations.map(item=>typeof item==='string'?item:String(item?.name||'')).filter(Boolean)
    : [];
}
function bundleOk(entry) {
  const p=path.resolve(root,entry.previewPath);
  if(!p.startsWith(root+path.sep))return false;
  try{fs.statSync(p);}
  catch{
    // Inventory checks indexes only; render/publish jobs validate the source.
    const files=(readIndex(root,entry.basePath)||[]).find(x=>x.id===entry.id)?.files||[];
    return files.some(f=>/\.(json|skel)$/i.test(f))&&
      files.some(f=>/\.atlas(?:\.txt|\.docx)?$/i.test(f))&&
      files.some(f=>/\.(png|jpe?g|webp|dds)$/i.test(f));
  }
  return inspectSourceTree(entry).complete;
}
const mediaNames=["preview.webm","preview-medium.webm","preview-low.webm",
  "preview.webp","preview-medium.webp","preview-low.webp"];
function refreshStoredPosters(entryInfo, stagingRoot) {
  const destination=path.resolve(root,entryInfo.previewPath);
  const staging=path.join(stagingRoot,"poster-refresh-"+entryInfo.id);
  fs.mkdirSync(staging,{recursive:true});
  const generated=[];
  for(const suffix of ["","-medium","-low"]){
    const video=path.join(destination,"preview"+suffix+".webm");
    const poster=path.join(staging,"preview"+suffix+".webp");
    generateFirstFrameWebp(video,poster);
    generated.push({poster,destination:path.join(destination,"preview"+suffix+".webp")});
  }
  let changed=false;
  for(const item of generated){
    const next=fs.readFileSync(item.poster);
    let previous;
    try{previous=fs.readFileSync(item.destination);}catch{}
    if(!previous||!previous.equals(next)){
      fs.copyFileSync(item.poster,item.destination);
      changed=true;
    }
  }
  fs.rmSync(staging,{recursive:true,force:true});
  return changed;
}
function refreshStoredPostersAndTimestamp(record,entryInfo,stagingRoot) {
  const changed=refreshStoredPosters(entryInfo,stagingRoot);
  if(changed||!record.posterGeneratedAt)
    record.posterGeneratedAt=new Date().toISOString();
  return changed;
}
function existingMediaOk(entry){
  const collection=readIndex(root,entry.basePath)||[];
  const record=collection.find(x=>x.id===entry.id);
  if(record?.webmStatus!=="ready"||record?.previewStatus!=="ready")return false;
  const frames=Number(record?.previewFrameCount||0);
  const duration=Number(record?.previewDuration||0);
  // A genuinely moving 8+ frame clip is still a usable low-quality preview.
  // Do not reject an already-installed original merely because its FPS is low.
  if(frames>0&&frames<8)return false;
  if(duration>0&&duration<0.5)return false;
  if(process.env.SPINE_REPAIR_INDEX_ONLY==="1")
    return Boolean(record?.webmPreview&&record?.webpPoster&&frames>=8&&duration>=0.5);
  const filesReady=mediaNames.every(name=>{
    try{return fs.statSync(path.join(root,entry.previewPath,name)).size>128;}
    catch{return false;}
  });
  if(!filesReady)return false;
  try{
    const probes={};
    for(const name of ["preview.webm","preview-medium.webm","preview-low.webm"]){
      const file=path.join(root,entry.previewPath,name);
      const data=JSON.parse(execFileSync("ffprobe",[
        "-v","error","-count_frames","-select_streams","v:0",
        "-show_entries","stream=width,height,nb_read_frames:format=duration",
        "-of","json",file,
      ],{encoding:"utf8",timeout:30000}));
      const stream=data.streams?.[0]||{};
      const item={width:Number(stream.width),height:Number(stream.height),
        frames:Number(stream.nb_read_frames),duration:Number(data.format?.duration)};
      if(!(item.width>0&&item.height>0&&item.frames>=8&&item.duration>=0.5))return false;
      probes[name]=item;
    }
    if(!(probes["preview-medium.webm"].width<probes["preview.webm"].width&&
      probes["preview-low.webm"].width<probes["preview-medium.webm"].width))return false;
    execFileSync(process.execPath,[path.join(root,"scripts/verify-preview-motion.mjs"),
      path.join(root,entry.previewPath,"preview.webm")],{stdio:"ignore",timeout:120000});
    return true;
  }catch{return false;}
}
// A green metadata flag is insufficient: check *all six* real media paths.
const mediaFields=[
  ["webmPreview","webm"],["webmPreviewMedium","webm"],["webmPreviewLow","webm"],
  ["webpPoster","webp"],["webpPosterMedium","webp"],["webpPosterLow","webp"],
];
async function liveMediaOk(entry){
  if(process.env.SPINE_REPAIR_SKIP_LIVE==="1")return existingMediaOk(entry);
  const record=(readIndex(root,entry.basePath)||[]).find(x=>x.id===entry.id);
  if(!record || record.webmStatus!=="ready" || !mediaFields.every(([key])=>record[key]))return false;
  const pathPrefix="/assets/"+entry.previewPath+"/";
  const results=await Promise.all(mediaFields.map(async ([key,kind])=>{
    let url;
    try{
      url=new URL(record[key]);
      if(url.origin!=="https://spine-link.vercel.app" || !url.pathname.startsWith(pathPrefix))
        return false;
    }catch{return false;}
    for(let retry=0;retry<2;retry++){
      try{
        const response=await fetch(url,{headers:{"Range":"bytes=0-1023","Cache-Control":"no-cache"},
          signal:AbortSignal.timeout(12000)});
        if(!response.ok)continue;
        const bytes=new Uint8Array(await response.arrayBuffer());
        if(kind==="webm" && bytes.length>=4 &&
          bytes[0]===0x1a && bytes[1]===0x45 && bytes[2]===0xdf && bytes[3]===0xa3)return true;
        if(kind==="webp" && bytes.length>=12 &&
          Buffer.from(bytes.subarray(0,4)).toString("ascii")==="RIFF" &&
          Buffer.from(bytes.subarray(8,12)).toString("ascii")==="WEBP")return true;
      }catch{}
    }
    return false;
  }));
  return results.every(Boolean);
}
// Vercel may alias a missing low poster to the high-quality one. Require
// the six ORIGINAL repository assets too, not just six HTTP 200 responses.
async function originalMediaFilesOk(entry){
  if(process.env.SPINE_REPAIR_SKIP_LIVE==="1")return true;
  const repoPath=entry.previewPath.split("/").map(encodeURIComponent).join("/");
  const token=process.env.GITHUB_TOKEN||"";
  try{
    const response=await fetch("https://api.github.com/repos/vladleopold/spine/contents/"+
      repoPath+"?ref=main",{headers:{Accept:"application/vnd.github+json",
      ...(token?{Authorization:"Bearer "+token}:{})},signal:AbortSignal.timeout(20000)});
    if(!response.ok)return false;
    const items=await response.json();
    if(!Array.isArray(items))return false;
    const names=new Set(items.map(x=>x.name));
    return mediaNames.every(name=>names.has(name));
  }catch{return false;}
}
const action=process.argv[2]||"matrix";
const latest=action==="matrix"?newestEntries():[];
if(action==="matrix"){
  if(latest.length!==repairLimit)throw new Error(`Cannot find ${repairLimit} recent entries`);
  // In the production inventory job, hydrate only source-complete entries with
  // an explicit animation before checking existing media. Index-only metadata
  // can prove that URLs exist, but cannot prove that the stored WebM actually
  // contains moving frames or that all three quality tiers decode correctly.
  if(process.env.GITHUB_ACTIONS==="true" && process.env.SPINE_REPAIR_INDEX_ONLY!=="1"){
    const sourcePaths=latest.filter(entry=>{
      const record=(readIndex(root,entry.basePath)||[]).find(item=>item.id===entry.id);
      const files=Array.isArray(record?.files)?record.files:[];
      const fileNames=files.map(file=>typeof file==="string"?file:String(file?.path||file?.name||file?.filename||"")).filter(Boolean);
      const hasSkeleton=fileNames.some(file=>/\.(json|skel)$/i.test(file));
      const hasAtlas=fileNames.some(file=>/\.atlas(?:\.txt|\.docx)?$/i.test(file));
      const hasTexture=fileNames.some(file=>/\.(png|jpe?g|webp|dds)$/i.test(file));
      // Hydrate every complete source bundle, including records with no
      // indexed defaultAnimation. The renderer now selects a deterministic
      // source track without rewriting the original upload metadata.
      return Boolean(record) && hasSkeleton && hasAtlas && hasTexture;
    }).map(entry=>{
      const relative=String(entry.previewPath||"").replace(/\\/g,"/");
      const resolved=path.resolve(root,relative);
      if(!relative.startsWith(String(entry.basePath||"")+"/") || relative.split("/").includes("..") || !resolved.startsWith(root+path.sep))throw new Error("Unsafe preview hydration path");
      return relative+"/";
    });
    if(sourcePaths.length)execFileSync("git",["sparse-checkout","add",...sourcePaths],{stdio:"inherit"});
    console.error("PREVIEW_SOURCE_HYDRATION_COUNT="+sourcePaths.length);
  }
  const matrix=[];
  // Bound concurrent production probes so the gallery is not flooded.
  for(let offset=0;offset<latest.length;offset+=4){
    const batch=await Promise.all(latest.slice(offset,offset+4).map(async (e,batchIndex)=>{
     const repairSlot=offset+batchIndex;
    const record=(readIndex(root,e.basePath)||[]).find(x=>x.id===e.id);
    const incompatible=record?.webmStatus==="blocked-incompatible-source-version";
    const sourceReady=bundleOk(e);
    const sourceAnimations=readSourceAnimationNames(e,record);
    // Keep an explicit selection verbatim; when it is absent, prefer Idle
    // and otherwise the first animation declared by the exact source skeleton.
    // Binary-only .skel uploads defer selection to the matching Spine runtime.
    // This is preview metadata only: source defaultAnimation and bytes stay unchanged.
    const preferredAnimation=typeof record?.defaultAnimation==='string'?record.defaultAnimation:'';
    const animation=preferredAnimation&&sourceAnimations.includes(preferredAnimation)
      ?preferredAnimation
      :(choosePreviewAnimation(sourceAnimations,'')||preferredAnimation||(sourceReady?'__SPINE_AUTO__':'' ));
    const sourceFingerprint=previewSourceFingerprint(record);
    const blockedStatuses=new Set(["blocked-invisible-default-skin","blocked-static-animation",
      "blocked-invalid-default-animation","blocked-incomplete-source","blocked-unsupported-runtime"]);
    const blockedSameSelection=blockedStatuses.has(record?.webmStatus) &&
      record?.previewBlockedAnimation===animation &&
      record?.previewBlockedSourceFingerprint===sourceFingerprint &&
      record?.previewBlockedRendererRevision===PREVIEW_RENDERER_REVISION &&
      String(record?.previewBlockedSkin||"")===String(record?.defaultSkin||record?.skin||"");
    const ready=!incompatible&&!blockedSameSelection&&Boolean(animation)&&sourceReady;
    const rel=String(e.previewPath).replace(/\\/g,"/");
    if(!rel.startsWith(e.basePath+"/")||rel.split("/").includes(".."))
      throw new Error("Unsafe preview path");
    return {repairSlot,id:e.id,basePath:e.basePath,previewPath:rel,
      uploadedAt:e.at,sourceFingerprint,
      indexedWebmStatus:String(record?.webmStatus||''),
      indexedPreviewStatus:String(record?.previewStatus||''),
      indexedPreviewAnimation:typeof record?.previewAnimation==='string'?record.previewAnimation:'',
      indexedAnimationCount:Array.isArray(record?.animations)?record.animations.length:0,
      indexedPreviewSetNames:record?.allAnimationPreviews&&typeof record.allAnimationPreviews==='object'
        ?Object.keys(record.allAnimationPreviews).slice(0,8):[],
      hasExplicitAnimation:Boolean(animation),
      ready,needsRender:ready && !(existingMediaOk(e) && await liveMediaOk(e) && await originalMediaFilesOk(e)),
      animation,
      blockedReason:!animation?"MISSING_SOURCE_ANIMATION":incompatible?"INCOMPATIBLE_SOURCE_VERSION":
        blockedSameSelection?(record.webmStatus==="blocked-static-animation"?"STATIC_ANIMATION":"INVISIBLE_DEFAULT_SKIN"):
        !sourceReady?"MISSING_SOURCE_TRIAD":""};
    }));
    matrix.push(...batch);
  }
  const required=matrix.filter(x=>x.needsRender);
  // GitHub Actions rejects an empty matrix. Keep one no-op entry when every
  // available clip has already been rendered and independently accepted.
  fs.writeFileSync(path.join(root,"repair-manifest.json"),JSON.stringify(matrix));
  console.log("matrix="+JSON.stringify(required.length?required:[matrix[0]]));
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
  console.error("AUDIT_LIMIT="+repairLimit+" ENTRIES="+matrix.length+" SOURCE_READY="+matrix.filter(x=>x.ready).length+
    " BLOCKED="+matrix.filter(x=>!x.ready).length);
}else if(action==="merge"){
  const selected=process.env.REPAIR_IDS_FILE
    ? JSON.parse(fs.readFileSync(process.env.REPAIR_IDS_FILE,"utf8"))
    : JSON.parse(process.env.REPAIR_IDS_JSON||"[]");
  if(selected.length!==repairLimit)throw new Error("Missing exact repair manifest");
  const base=path.resolve(root,"downloaded-latest50");
  const indexes=new Map(),summary={ready:0,failed:0,blocked:0};
  const folders=listCollectionFolders(root);
  const seen=new Set(),seenSlots=new Set();
  for(const item of selected){
    if(!Number.isInteger(item.repairSlot)||item.repairSlot<0||item.repairSlot>=repairLimit||seenSlots.has(item.repairSlot))
      throw new Error("Invalid artifact slot");
    seenSlots.add(item.repairSlot);
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
      const issue=sourceIssue(entryInfo);
      const unsupported=issue==="UNSUPPORTED_SPINE_EXPORT_3_8_75";
      record.webmStatus=unsupported?"blocked-incompatible-source-version":"blocked-missing-source";
      record.previewStatus="blocked";
      record.previewError=unsupported
        ?"Spine 3.8.75 export is rejected by official runtimes; re-export from the original Spine project required"
        :"Incomplete skeleton, atlas page, or texture bundle";
      summary.blocked++;
      continue;
    }
    const selectedAnimation=choosePreviewAnimation([],item.animation);
    const blockedStatuses=new Set(["blocked-invisible-default-skin","blocked-static-animation",
      "blocked-invalid-default-animation","blocked-incomplete-source","blocked-unsupported-runtime"]);
    const blockedSameSelection=blockedStatuses.has(record.webmStatus) &&
      record.previewBlockedAnimation===selectedAnimation &&
      record.previewBlockedSourceFingerprint===item.sourceFingerprint &&
      record.previewBlockedRendererRevision===PREVIEW_RENDERER_REVISION &&
      String(record.previewBlockedSkin||"")===String(record.defaultSkin||record.skin||"");
    if(blockedSameSelection){
      summary.blocked++;
      continue;
    }
    if(!selectedAnimation){
      // Without an exact selected/default timeline, even an older installed
      // WebM cannot be proven to represent the requested animation. Preserve
      // the media bytes, but never advertise them as accepted or refresh posters.
      record.webmStatus="blocked-missing-animation-selection";
      record.previewStatus="blocked";
      record.previewError="No explicit default animation is selected; existing media cannot be attributed to an exact source animation";
      summary.blocked++;
      continue;
    }
    if(item.needsRender===false){
      if(existingMediaOk(entryInfo)){
        try{
          // Existing accepted WebM stays byte-for-byte unchanged; rebuild only
          // its matching WebP posters from frame zero of each quality tier.
          refreshStoredPostersAndTimestamp(record,entryInfo,base);
          record.previewAnimation=selectedAnimation;
          summary.ready++;
        }catch{
          record.webmStatus="failed";
          record.previewStatus="failed";
          record.previewError="Existing WebM could not produce its exact first-frame WebP poster";
          summary.failed++;
        }
        continue;
      }
      record.webmStatus="failed";
      record.previewStatus="failed";
      record.previewError="Media previously marked ready but expected outputs are missing";
      summary.failed++;
      continue;
    }
    const artifact=path.join(base,"latest50-"+item.repairSlot);
    const metaPath=path.join(artifact,"meta.json");
    let meta=null;
    try{meta=JSON.parse(fs.readFileSync(metaPath,"utf8"));}catch{}
    const names=["preview.webm","preview-medium.webm","preview-low.webm",
      "preview.webp","preview-medium.webp","preview-low.webp"];
    let complete=meta?.ok===true && meta?.animationMatches===true &&
      choosePreviewAnimation([],meta?.animation)===choosePreviewAnimation([],item.animation) && names.every(n=>
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
          if(!(seconds>=0.5&&frames>=8&&stream?.width>0&&stream?.height>0))
            throw new Error("Video has too few real frames");
          if(name==="preview.webm")mainVideo={frames,seconds};
        }
      }catch{complete=false;}
    }
    if(complete){
      try{
        // Rebuild each poster from the first frame of its own matching WebM,
        // even if the renderer artifact carried an older/scanned still.
        for(const suffix of ["","-medium","-low"]){
          generateFirstFrameWebp(
            path.join(artifact,"preview"+suffix+".webm"),
            path.join(artifact,"preview"+suffix+".webp")
          );
        }
      }catch{complete=false;}
    }
    if(!complete) {
      // A previous completed job may have already published genuine complete
      // media while this older job was rendering. Do not downgrade an
      // independently valid six-file source simply because this attempt failed.
      // Local source and frame-density gates remain mandatory.
      if(record.webmStatus==="ready" && record.webmPreview && record.webpPoster &&
         existingMediaOk(entryInfo)) {
        try{
          refreshStoredPostersAndTimestamp(record,entryInfo,base);
          record.lastPreviewRetryError="Concurrent retry had no accepted media; verified original WebM retained";
          summary.ready++;
        }catch{
          record.webmStatus="failed";
          record.previewStatus="failed";
          record.previewError="Retained WebM could not produce its exact first-frame WebP poster";
          summary.failed++;
        }
        continue;
      }
      // A blank or frame-identical selected track is not a transient renderer
      // failure. Keep it blocked until the exact animation or skin selection changes.
      if(["blocked-invisible-default-skin","blocked-static-animation","blocked-invalid-default-animation",
          "blocked-incomplete-source","blocked-unsupported-runtime"].includes(meta?.reason)){
        record.webmStatus=meta.reason;
        record.previewStatus="blocked";
        record.previewBlockedAnimation=selectedAnimation;
        record.previewBlockedSourceFingerprint=item.sourceFingerprint;
        record.previewBlockedRendererRevision=PREVIEW_RENDERER_REVISION;
        record.previewBlockedSkin=String(record.defaultSkin||record.skin||"");
        record.previewBlockedAt=new Date().toISOString();
        record.previewError={
          "blocked-static-animation":"Selected default animation has no changing frames; choose an animated track before rendering",
          "blocked-invisible-default-skin":"Source-default skin produces no visible Spine pixels; choose an explicit skin before rendering",
          "blocked-invalid-default-animation":"The indexed default animation is not present in the source skeleton; select an exact available animation",
          "blocked-incomplete-source":"The indexed skeleton, atlas or texture source graph cannot be loaded completely",
          "blocked-unsupported-runtime":"The source Spine version is not supported by the pinned renderer",
        }[meta.reason];
        record.lastPreviewRetryError="";
        summary.blocked++;
        continue;
      }
      // No existing independently validated media: mark failed, never fake it.
      record.lastPreviewRetryError="Live media missing or replacement failed real motion acceptance";
      record.webmStatus="failed";
      record.previewStatus="failed";
      record.previewError="Native preview render did not pass media acceptance";
      summary.failed++;
      continue;
    }
    const destination=path.resolve(root,entryInfo.previewPath);
    for(const name of names)fs.copyFileSync(path.join(artifact,name),path.join(destination,name));
    const prefix="https://spine-link.vercel.app/assets/"+entryInfo.previewPath.replace(/\\/g,"/")+"/";
    const animation=choosePreviewAnimation([],meta.animation);
    record.previewAnimation=animation;
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
    delete record.previewBlockedAnimation;
    delete record.previewBlockedSourceFingerprint;
    delete record.previewBlockedRendererRevision;
    delete record.previewBlockedSkin;
    delete record.previewBlockedAt;
    const now=new Date().toISOString();
    record.webmGeneratedAt=now;
    record.posterGeneratedAt=now;
    // Preserve the source index defaultAnimation; preview publication only adds media metadata.
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
  for(const [p,a] of indexes){
    // Do not create a commit for formatting-only differences such as a missing
    // trailing newline left by an E2E delete. Scheduled recovery must be a no-op
    // when the published records have not semantically changed.
    const current=JSON.parse(fs.readFileSync(p,"utf8"));
    if(JSON.stringify(current)===JSON.stringify(a))continue;
    fs.writeFileSync(p,JSON.stringify(a,null,2)+"\n");
  }
  fs.writeFileSync(path.join(root,"preview-repair-summary.json"), JSON.stringify(summary));
  console.log("PREVIEW_REPAIR_RESULT="+JSON.stringify(summary));
}else throw new Error("Unsupported action");
