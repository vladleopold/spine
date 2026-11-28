import {publishLargeDownload} from './publish-large-download.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {runCommand} from './lib/run-command.mjs';
import {entryForUpload} from './resolve-library.mjs';
import {previewSourceFingerprint} from './repair-manifest-guard.mjs';
import {missingAnimationPreviewMetadata} from './lib/spine-export-entry.mjs';
import {resolveRenderSelection,writeRenderVerification} from './lib/render-selection.mjs';
import {parseGameCamera} from './lib/game-camera.mjs';
const event=JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH,'utf8'));
const config=process.env.GITHUB_EVENT_NAME==='push'?JSON.parse(fs.readFileSync('scripts/render-check.json','utf8')):(event.client_payload||event.inputs||{});
const wait=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function dispatchFullExport(payload){
 const endpoint=`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/dispatches`;
 const body=JSON.stringify({event_type:'spine-export-full',client_payload:payload});
 for(let attempt=0;attempt<5;attempt++){
  let response;
  try{
   response=await fetch(endpoint,{method:'POST',headers:{
    Authorization:`Bearer ${process.env.GITHUB_TOKEN}`,
    Accept:'application/vnd.github+json',
    'Content-Type':'application/json',
    'X-GitHub-Api-Version':'2022-11-28',
   },body});
  }catch{
   if(attempt===4){const error=new Error('Full export dispatch network failure');error.code='FULL_EXPORT_DISPATCH_NETWORK_ERROR';throw error;}
   console.warn(`FULL_EXPORT_DISPATCH_RETRY=${attempt+1} NETWORK`);
   await wait(Math.min(1000*2**attempt,15000));
   continue;
  }
  if(response.ok){console.log('FULL_EXPORT_DISPATCH_ACCEPTED=1');return;}
  const status=response.status;
  if([408,422,429,500,502,503,504].includes(status)&&attempt<4){
   const retryAfter=Number(response.headers?.get?.('retry-after')||0)*1000;
   console.warn(`FULL_EXPORT_DISPATCH_RETRY=${attempt+1} HTTP_${status}`);
   await wait(Math.max(retryAfter,Math.min(1000*2**attempt,15000)));
   continue;
  }
  const error=new Error(`Full export dispatch failed: HTTP ${status}`);
  error.code=`FULL_EXPORT_DISPATCH_HTTP_${status}`;
  throw error;
 }
 const error=new Error('Full export dispatch retries exhausted');
 error.code='FULL_EXPORT_DISPATCH_RETRIES_EXHAUSTED';
 throw error;
}
const id=String(config.uploadId||'');
if(id)console.log(`::add-mask::${id}`);
if(!/^[\w.-]+$/.test(id)||id.includes('..'))throw Error('Invalid upload ID');
const origin=new URL(config.origin||'https://spine-link.vercel.app').origin;
if(origin!=='https://spine-link.vercel.app')throw Error('Unsupported preview origin');
const found=entryForUpload(process.cwd(),id);if(!found)throw Error('Upload not found');
if (config.dispatchOnly === true && process.env.GITHUB_EVENT_NAME === 'push') {
  await dispatchFullExport({uploadId:id,origin,owner:'vladleopold',repo:'spine',branch:'main'});
  console.log('Full export verification dispatched');process.exit(0);
}
const selection=resolveRenderSelection(config,found.entry);
const workPath=found.entry.previewPath||`${found.basePath}/${id}`;
const privateValues=[workPath,found.entry.previewPath,found.entry.skeleton,found.entry.atlas,
  selection.animation,...(Array.isArray(found.entry.files)?found.entry.files:[]),
  ...(Array.isArray(found.entry.animations)?found.entry.animations:[])];
for(const value of new Set(privateValues.map(value=>String(value||'').trim())
  .filter(value=>value.length>=4&&!/[\\r\\n]/.test(value))))
 console.log(`::add-mask::${value}`);
const report={
 status:selection.status==='blocked'?'blocked':'rendering',
 code:selection.code||null,
 formats:[],
};
const writeReport=()=>writeRenderVerification('render-verification.json',report);
const commandTimeoutMs=cmd=>({
 git:120_000,
 ffprobe:90_000,
 ffmpeg:15*60_000,
 zip:5*60_000,
 node:15*60_000,
})[path.basename(cmd)]||120_000;
function executeCommand(cmd,args,stdio,forwardOutput=true){
 const timeoutMs=commandTimeoutMs(cmd);
 const name=path.basename(cmd);
 console.log(`RENDER_COMMAND_START=${name} timeoutMs=${timeoutMs}`);
 const result=runCommand(cmd,args,{stdio,timeoutMs,maxBuffer:64*1024*1024});
 const stdout=String(result.stdout||''),stderr=String(result.stderr||'');
 if(forwardOutput&&stdout)process.stdout.write(stdout);
 if(forwardOutput&&stderr)process.stderr.write(stderr);
 console.log(`RENDER_COMMAND_DONE=${name} elapsedMs=${result.elapsedMs} exitCode=${result.status}`);
 if(result.status!==0){
  const error=new Error(`Renderer command failed with exit code ${result.status}`);
  error.command=cmd;
  error.elapsedMs=result.elapsedMs;
  error.renderOutput=stdout+'\\n'+stderr;
  error.status=result.status;
  throw error;
 }
 return stdout;
}
const run=(cmd,args)=>executeCommand(cmd,args,'inherit');
const runCaptured=(cmd,args)=>executeCommand(cmd,args,['inherit','pipe','pipe']);
const capture=(cmd,args)=>executeCommand(cmd,args,'pipe',false);
function staleRenderError(message){
 const error=new Error(message);
 error.code='STALE_RENDER_SUPERSEDED';
 return error;
}
async function markBlockedRender(status,distinctError){
 const expectedFingerprint=previewSourceFingerprint(found.entry);
 const expectedSkin=String(found.entry.defaultSkin||found.entry.skin||'');
 const animation=selection.animation;
 const message={
  'blocked-static-animation':'Selected default animation has no changing frames; choose an animated track before rendering',
  'blocked-invisible-default-skin':'Source-default skin produces no visible Spine pixels; choose an explicit skin before rendering',
  'blocked-invalid-default-animation':'The indexed default animation is not present in the source skeleton; select an exact available animation',
  'blocked-incomplete-source':'The indexed skeleton, atlas or texture source graph cannot be loaded completely',
  'blocked-unsupported-runtime':'The source Spine version is not supported by the pinned renderer',
 }[status]||'Selected Spine preview cannot be rendered with the current source metadata';
 for(let attempt=0;attempt<8;attempt++){
  run('git',['fetch','--no-tags','origin','+refs/heads/main:refs/remotes/origin/main']);
  run('git',['reset','--hard','origin/main']);
  const current=entryForUpload(process.cwd(),id);
  if(!current||!Array.isArray(current.index))throw staleRenderError('Upload index unavailable');
  const index=current.index;
  const indexPosition=index.findIndex(entry=>entry?.id===id);
  if(indexPosition<0)throw staleRenderError('Upload removed before blocked render status update');
  const record=index[indexPosition];
  if(record.defaultAnimation!==animation)throw staleRenderError('Default animation changed before blocked render status update');
  const fingerprint=previewSourceFingerprint(record);
  const skin=String(record.defaultSkin||record.skin||'');
  if(fingerprint!==expectedFingerprint||skin!==expectedSkin)throw staleRenderError('Source or skin selection changed before blocked render status update');
  record.webmStatus=status;
  record.previewStatus='blocked';
  record.previewBlockedAnimation=animation;
  record.previewBlockedSourceFingerprint=fingerprint;
  record.previewBlockedSkin=skin;
  record.previewBlockedDistinctError=distinctError;
  record.previewBlockedAt=new Date().toISOString();
  record.previewError=message;
  record.lastPreviewRetryError='';
  const indexPath=path.join(current.basePath,'index.json');
  fs.writeFileSync(indexPath,JSON.stringify(index,null,2));
  run('git',['add','--',indexPath]);
  if(!capture('git',['diff','--cached','--name-only']).trim())return;
  run('git',['-c','user.name=github-actions[bot]','-c','user.email=github-actions[bot]@users.noreply.github.com','commit','-m','Mark non-renderable Spine preview as blocked']);
  try{
   run('git',['-c','http.version=HTTP/1.1','push','origin','HEAD:main']);
   return;
  }catch(error){
   if(attempt===7)throw error;console.warn(`MAIN_PUSH_RETRY=${attempt+1}`);await wait(Math.min(1000*2**attempt,15000));
  }
 }
}
async function markBlockedSelection(){
  for(let attempt=0;attempt<8;attempt++){
    run('git',['fetch','--no-tags','origin','+refs/heads/main:refs/remotes/origin/main']);
    run('git',['reset','--hard','origin/main']);
    const current=entryForUpload(process.cwd(),id);
    if(!current||!Array.isArray(current.index))throw staleRenderError('Upload index unavailable');
    const index=current.index;
    const indexPosition=index.findIndex(entry=>entry?.id===id);
    if(indexPosition<0)throw staleRenderError('Upload removed before blocked status update');
    const record=index[indexPosition];
    const blocked=missingAnimationPreviewMetadata(record);
    if(!blocked)throw staleRenderError('Explicit animation selection changed before blocked status update');
    Object.assign(record,blocked);
    const indexPath=path.join(current.basePath,'index.json');
    fs.writeFileSync(indexPath,JSON.stringify(index,null,2));
    run('git',['add','--',indexPath]);
    if(!capture('git',['diff','--cached','--name-only']).trim())return;
    run('git',['-c','user.name=github-actions[bot]','-c','user.email=github-actions[bot]@users.noreply.github.com','commit','-m','Mark unselected Spine preview as blocked']);
    try{
      run('git',['-c','http.version=HTTP/1.1','push','origin','HEAD:main']);
      return;
    }catch(error){
      if(attempt===7)throw error;console.warn(`MAIN_PUSH_RETRY=${attempt+1}`);await wait(Math.min(1000*2**attempt,15000));
    }
  }
}
process.on('uncaughtException',error=>{
 const safeCode=typeof error?.code==='string'&&/^[A-Z0-9_]{2,64}$/.test(error.code)?error.code:'RENDER_FAILED';
 if(safeCode==='STALE_RENDER_SUPERSEDED'){
  report.status='superseded';report.code=safeCode;writeReport();
  console.log('SPINE_RENDER_SUPERSEDED=SOURCE_CHANGED_DURING_RENDER');
  process.exit(0);
 }
 if(report.status==='ready'&&safeCode.startsWith('FULL_EXPORT_DISPATCH_')){
  report.status='partial';report.renderStatus='ready';report.dispatchStatus='failed';report.code=safeCode;
  writeReport();console.error(`SPINE_EXPORT_PARTIAL=${safeCode}`);
 }else{
  report.status='failed';report.code=safeCode;writeReport();console.error(`SPINE_RENDER_FAILED=${safeCode}`);
 }
 process.exit(1);
});
if(selection.status==='blocked'){
 writeReport();
 try{
  await markBlockedSelection();
 }catch{
  report.status='failed';
  report.code='BLOCKED_STATUS_PUBLISH_FAILED';
  writeReport();
  console.error('SPINE_BLOCKED_STATUS_PUBLISH_FAILED');
  process.exit(1);
 }
 console.log('SPINE_PREVIEW_BLOCKED=NO_DEFAULT_SPINE_ANIMATION');
 process.exit(1);
}
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'spine-render-'));
const base=path.join(temp,'preview.webm');
const flags=[`--upload-id=${id}`,`--animation=${selection.animation}`,`--repo-path=${process.cwd()}`,`--origin=${origin}`,`--output=${base}`];
const gameCamera=parseGameCamera(config.gameCamera);
if(gameCamera)flags.push(`--game-camera=${gameCamera.width}x${gameCamera.height}`);
if(selection.animation==='__SPINE_AUTO__')flags.push('--allow-visible-track-fallback');
try{
 runCaptured('node',['scripts/spine-export-webm.mjs',...flags]);
}catch(error){
 const logPath=path.join(temp,'renderer.log');
 fs.writeFileSync(logPath,String(error.renderOutput||error.message||''));
 const classified=capture('node',['scripts/renderer-failure-class.mjs',logPath]);
 console.log(classified.trim());
 const result=JSON.parse(classified.replace(/^SANITIZED_RENDER_RESULT=/,'').trim());
 const blockedStatus=result.distinctError==='COMPOSITED_FRAMES_IDENTICAL'
  ?'blocked-static-animation'
  :['COMPOSITED_FRAMES_NOT_VISIBLE','RUNTIME_ALL_SKINS_INVISIBLE'].includes(result.distinctError)
   ?'blocked-invisible-default-skin'
   :result.distinctError==='ANIMATION_SELECTION'
    ?'blocked-invalid-default-animation'
    :['SOURCE_GRAPH_MISSING','ATLAS_TEXTURE_LOAD'].includes(result.distinctError)
     ?'blocked-incomplete-source'
     :['SKELETON_RUNTIME_VERSION','UNSUPPORTED_SPINE_EXPORT_VERSION'].includes(result.distinctError)
      ?'blocked-unsupported-runtime':'';
 if(blockedStatus){
  await markBlockedRender(blockedStatus,result.distinctError);
  report.status='blocked';
  report.code={
    'blocked-static-animation':'STATIC_ANIMATION',
    'blocked-invisible-default-skin':'INVISIBLE_DEFAULT_SKIN',
    'blocked-invalid-default-animation':'INVALID_DEFAULT_ANIMATION',
    'blocked-incomplete-source':'INCOMPLETE_SOURCE',
    'blocked-unsupported-runtime':'UNSUPPORTED_RUNTIME',
  }[blockedStatus];
  writeReport();
  console.error('SPINE_PREVIEW_BLOCKED='+report.code);
  process.exit(0);
 }
 throw error;
}
const meta=JSON.parse(fs.readFileSync(base+'.json','utf8'));
report.status='rendering';
report.code=null;
function probe(file){
 const data=JSON.parse(capture('ffprobe',['-v','error','-count_frames','-select_streams','v:0','-show_entries','stream=width,height,nb_read_frames,codec_name,pix_fmt:format=duration','-of','json',file]));
 const s=data.streams[0];if(!s?.width||!Number(s.nb_read_frames))throw Error('Empty render: '+file);
 report.formats.push({file:path.basename(file),...s,duration:Number(data.format?.duration)});return s;
}
const pending=[];
const add=(src,dst)=>{if(!fs.existsSync(src)||fs.statSync(src).size===0)throw Error('Missing output '+src);pending.push({src,dst});};
// Publish card first so the animation card does not wait for the full matrix.
for(const suffix of ['','-medium','-low'])for(const ext of ['webm','webp']){const file=path.join(temp,`preview${suffix}.${ext}`);probe(file);add(file,`${workPath}/preview${suffix}.${ext}`);}
async function pushStaged(message){
 if(!capture('git',['diff','--cached','--name-only']).trim())return;
 run('git',['-c','user.name=github-actions[bot]','-c','user.email=github-actions[bot]@users.noreply.github.com','commit','-m',message]);
 run('git',['-c','http.version=HTTP/1.1','-c','http.postBuffer=524288000','push','origin','HEAD:main']);
}
async function publish(update){
 // Push one media object at a time. Never recreate a multi-hundred-MB pack
 // after a timeout, and check the remote on retries (a push may have landed).
 for(const file of pending){
  for(let attempt=0;attempt<8;attempt++){
   run('git',['fetch','--no-tags','origin','+refs/heads/main:refs/remotes/origin/main']);
   run('git',['reset','--hard','origin/main']);
   fs.mkdirSync(path.dirname(file.dst),{recursive:true});fs.copyFileSync(file.src,file.dst);
   run('git',['add','--',file.dst]);
   try{await pushStaged('Publish verified Spine preview media asset');break;}
   catch(error){if(attempt===7)throw error;console.warn(`MAIN_PUSH_RETRY=${attempt+1}`);await wait(Math.min(1000*2**attempt,15000));}
  }
 }
 for(let attempt=0;attempt<8;attempt++){
  run('git',['fetch','--no-tags','origin','+refs/heads/main:refs/remotes/origin/main']);run('git',['reset','--hard','origin/main']);
  const current=entryForUpload(process.cwd(),id);if(!current)throw Error('Upload removed during render');
  const idx=current.index.findIndex(e=>e.id===id);
  const merged={...current.index[idx],...update};
  if(update.allAnimationPreviews)merged.allAnimationPreviews={...current.index[idx].allAnimationPreviews,...update.allAnimationPreviews};
  current.index[idx]=merged;
  const indexPath=`${current.basePath}/index.json`;fs.writeFileSync(indexPath,JSON.stringify(current.index,null,2));
  run('git',['add','--',indexPath]);
  try{await pushStaged('Publish verified Spine preview index metadata');pending.length=0;return;}
  catch(error){if(attempt===7)throw error;console.warn(`MAIN_PUSH_RETRY=${attempt+1}`);await wait(Math.min(1000*2**attempt,15000));}
 }
}
const url=file=>`${origin}/assets/${workPath}/${file}`;
await publish({webmStatus:'ready',webmError:null,webmPreview:url('preview.webm'),webmPreviewMedium:url('preview-medium.webm'),webmPreviewLow:url('preview-low.webm'),webmPreviewPath:`${workPath}/preview.webm`,webpPoster:url('preview.webp'),webpPosterMedium:url('preview-medium.webp'),webpPosterLow:url('preview-low.webp'),previewWidth:meta.width,previewHeight:meta.height,previewDuration:meta.animationDuration,qualityWidths:meta.qualityWidths,defaultAnimation:meta.animation,previewAnimation:meta.animation,animations:meta.animations,skeleton:meta.skeleton,atlas:meta.atlas,textures:meta.textures,webmGeneratedAt:new Date().toISOString()});
// Verify every Download format and size on the requested animation. Remaining
// animations are handled by the existing full-export workflow after this run.
run('node',['scripts/spine-export-webm.mjs',...flags.filter(f=>!f.startsWith('--output=')),'--alpha',`--output=${path.join(temp,'alpha.webm')}`]);
const anim=meta.animation;
const safe=anim.replace(/[^a-zA-Z0-9_-]/g,'_');
const downloads={...(found.entry.allAnimationPreviews?.[anim]||{}),qualityWidths:meta.qualityWidths,previewDuration:meta.animationDuration};
for(const [suffix,cap]of [['',''],['-medium','Medium'],['-low','Low']]){
 const opaque=path.join(temp,`preview${suffix}.webm`),alpha=path.join(temp,`alpha${suffix}.webm`);
 probe(alpha);
 const mp4=path.join(temp,`preview${suffix}.mp4`),mov=path.join(temp,`alpha${suffix}.mov`),gif=path.join(temp,`alpha${suffix}.gif`),zip=path.join(temp,`alpha${suffix}.png.zip`);
 run('ffmpeg',['-y','-v','error','-i',opaque,'-c:v','libx264','-pix_fmt','yuv420p','-movflags','+faststart',mp4]);
 run('ffmpeg',['-y','-v','error','-c:v','libvpx-vp9','-i',alpha,'-c:v','prores_ks','-profile:v','4','-pix_fmt','yuva444p10le',mov]);
 run('ffmpeg',['-y','-v','error','-c:v','libvpx-vp9','-i',alpha,'-filter_complex','fps=15,split[a][b];[a]palettegen=reserve_transparent=1[p];[b][p]paletteuse','-loop','0',gif]);
 const pngdir=path.join(temp,`png${suffix}`);fs.mkdirSync(pngdir,{recursive:true});
 run('ffmpeg',['-y','-v','error','-c:v','libvpx-vp9','-i',alpha,'-pix_fmt','rgba',path.join(pngdir,'frame-%06d.png')]);
 execFileSync('zip',['-q',zip,...fs.readdirSync(pngdir)],{cwd:pngdir});
 for(const file of [mp4,mov,gif])probe(file);
 for(const [file,key]of [[opaque,'webmPreview'],[alpha,'webmAlpha'],[mp4,'mp4Preview'],[mov,'movAlpha'],[gif,'gifAlpha'],[zip,'pngAlpha'],[path.join(temp,`preview${suffix}.webp`),'webpPoster']]){
  const dst=`${workPath}/animations/${safe}/${path.basename(file)}`;
  if(fs.statSync(file).size>20*1024*1024){
   downloads[key+cap]=await publishLargeDownload(file,{repository:process.env.GITHUB_REPOSITORY,token:process.env.GITHUB_TOKEN,uploadId:id});
  }else{add(file,dst);downloads[key+cap]=`${origin}/assets/${dst}`;}
 }
}
const existingPreviews={...(entryForUpload(process.cwd(),id).entry.allAnimationPreviews||{})};
delete existingPreviews.__SPINE_AUTO__;
await publish({allAnimationPreviews:{...existingPreviews,[anim]:downloads},fullExportStatus:(meta.animations.length===1?'ready':'partial'),fullExportGeneratedAt:new Date().toISOString()});
report.status='ready';
report.code=null;
writeReport();
for (const targetId of new Set([id, ...(process.env.GITHUB_EVENT_NAME === 'push' ? (config.verifyUploadIds || []) : [])])) {
 await dispatchFullExport({uploadId:targetId,origin,owner:'vladleopold',repo:'spine',branch:'main'});
}
console.log(JSON.stringify({ok:true,...report}));
