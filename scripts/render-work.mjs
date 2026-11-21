import {publishLargeDownload} from './publish-large-download.mjs';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {entryForUpload} from './resolve-library.mjs';
import {missingAnimationPreviewMetadata} from './lib/spine-export-entry.mjs';
import {resolveRenderSelection,writeRenderVerification} from './lib/render-selection.mjs';
const event=JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH,'utf8'));
const config=process.env.GITHUB_EVENT_NAME==='push'?JSON.parse(fs.readFileSync('scripts/render-check.json','utf8')):(event.client_payload||event.inputs||{});
const id=String(config.uploadId||'');
if(id)console.log(`::add-mask::${id}`);
if(!/^[\w.-]+$/.test(id)||id.includes('..'))throw Error('Invalid upload ID');
const origin=new URL(config.origin||'https://spine-link.vercel.app').origin;
if(origin!=='https://spine-link.vercel.app')throw Error('Unsupported preview origin');
const found=entryForUpload(process.cwd(),id);if(!found)throw Error('Upload not found');
if (config.dispatchOnly === true && process.env.GITHUB_EVENT_NAME === 'push') {
  const response=await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/dispatches`,{method:'POST',headers:{Authorization:`Bearer ${process.env.GITHUB_TOKEN}`,Accept:'application/vnd.github+json','Content-Type':'application/json'},body:JSON.stringify({event_type:'spine-export-full',client_payload:{uploadId:id,origin,owner:'vladleopold',repo:'spine',branch:'main'}})});
  if(!response.ok)throw Error('Full export dispatch failed: '+response.status);
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
let primaryPreviewPublished=false;
const run=(cmd,args)=>execFileSync(cmd,args,{stdio:'inherit'});
async function markPreviewBlocked(expectedAnimation, reason='render-failed'){
 for(let attempt=0;attempt<5;attempt++){
  run('git',['fetch','--no-tags','origin','+refs/heads/main:refs/remotes/origin/main']);
  run('git',['reset','--hard','origin/main']);
  const current=entryForUpload(process.cwd(),id);
  if(!current||!Array.isArray(current.index))throw Error('Upload index unavailable');
  const index=current.index;
  const indexPosition=index.findIndex(entry=>entry?.id===id);
  if(indexPosition<0)throw Error('Upload removed before blocked status update');
  const record=index[indexPosition];
  const currentAnimation=typeof record.defaultAnimation==='string'?record.defaultAnimation:'';
  const sameSelection=expectedAnimation===''?!currentAnimation.trim():currentAnimation===expectedAnimation;
  if(!sameSelection)return false;
  const blocked=missingAnimationPreviewMetadata(record)||{
   webmStatus:'blocked-render-failed',
   previewStatus:'blocked',
   dispatchStatus:'blocked',
   webmError:reason,
   previewError:reason,
  };
  Object.assign(record,blocked);
  const indexPath=path.join(current.basePath,'index.json');
  fs.writeFileSync(indexPath,JSON.stringify(index,null,2));
  run('git',['add','--',indexPath]);
  if(!execFileSync('git',['diff','--cached','--name-only'],{encoding:'utf8'}).trim())return true;
  run('git',['-c','user.name=github-actions[bot]','-c','user.email=github-actions[bot]@users.noreply.github.com','commit','-m','Mark unaccepted Spine preview as blocked']);
  try{
   run('git',['-c','http.version=HTTP/1.1','push','origin','HEAD:main']);
   return true;
  }catch(error){
   if(attempt===4)throw error;
  }
 }
 return false;
}
process.on('uncaughtException',async error=>{
 report.status='failed';
 report.code=report.code||'RENDER_FAILED';
 const safeCode=typeof error?.code==='string'&&/^[A-Z0-9_]{2,64}$/.test(error.code)?error.code:'RENDER_FAILED';
 report.code=safeCode;
 writeReport();
 if(!primaryPreviewPublished){
  try{
   await markPreviewBlocked(selection.animation,'render-failed');
  }catch{
   console.error('SPINE_BLOCKED_STATUS_PUBLISH_FAILED');
  }
 }else{
  console.error('SPINE_SECONDARY_EXPORT_FAILED_PRIMARY_PREVIEW_READY');
 }
 console.error(`SPINE_RENDER_FAILED=${safeCode}`);
 process.exit(1);
});
if(selection.status==='blocked'){
 writeReport();
 try{
  await markPreviewBlocked(selection.animation,'missing-default-animation');
 }catch{
  console.error('SPINE_BLOCKED_STATUS_PUBLISH_FAILED');
 }
 console.error('SPINE_PREVIEW_BLOCKED=NO_DEFAULT_SPINE_ANIMATION');
 process.exit(1);
}
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'spine-render-'));
const base=path.join(temp,'preview.webm');
const flags=[`--upload-id=${id}`,`--animation=${selection.animation}`,`--repo-path=${process.cwd()}`,`--origin=${origin}`,`--output=${base}`];
run('node',['scripts/spine-export-webm.mjs',...flags]);
const meta=JSON.parse(fs.readFileSync(base+'.json','utf8'));
report.status='rendering';
report.code=null;
function probe(file){
 const data=JSON.parse(execFileSync('ffprobe',['-v','error','-count_frames','-select_streams','v:0','-show_entries','stream=width,height,nb_read_frames,codec_name,pix_fmt:format=duration','-of','json',file],{encoding:'utf8'}));
 const s=data.streams[0];if(!s?.width||!Number(s.nb_read_frames))throw Error('Empty render: '+file);
 report.formats.push({file:path.basename(file),...s,duration:Number(data.format?.duration)});return s;
}
const pending=[];
const add=(src,dst)=>{if(!fs.existsSync(src)||fs.statSync(src).size===0)throw Error('Missing output '+src);pending.push({src,dst});};
// Publish card first so the animation card does not wait for the full matrix.
for(const suffix of ['','-medium','-low'])for(const ext of ['webm','webp']){const file=path.join(temp,`preview${suffix}.${ext}`);probe(file);add(file,`${workPath}/preview${suffix}.${ext}`);}
async function pushStaged(message){
 if(!execFileSync('git',['diff','--cached','--name-only'],{encoding:'utf8'}).trim())return;
 run('git',['-c','user.name=github-actions[bot]','-c','user.email=github-actions[bot]@users.noreply.github.com','commit','-m',message]);
 run('git',['-c','http.version=HTTP/1.1','-c','http.postBuffer=524288000','push','origin','HEAD:main']);
}
async function publish(update){
 // Push one media object at a time. Never recreate a multi-hundred-MB pack
 // after a timeout, and check the remote on retries (a push may have landed).
 for(const file of pending){
  for(let attempt=0;attempt<5;attempt++){
   run('git',['fetch','--no-tags','origin','+refs/heads/main:refs/remotes/origin/main']);
   run('git',['reset','--hard','origin/main']);
   fs.mkdirSync(path.dirname(file.dst),{recursive:true});fs.copyFileSync(file.src,file.dst);
   run('git',['add','--',file.dst]);
   try{await pushStaged('Publish verified Spine preview media asset');break;}
   catch(error){if(attempt===4)throw error;}
  }
 }
 for(let attempt=0;attempt<5;attempt++){
  run('git',['fetch','--no-tags','origin','+refs/heads/main:refs/remotes/origin/main']);run('git',['reset','--hard','origin/main']);
  const current=entryForUpload(process.cwd(),id);if(!current)throw Error('Upload removed during render');
  const idx=current.index.findIndex(e=>e.id===id);
  const merged={...current.index[idx],...update};
  if(update.allAnimationPreviews)merged.allAnimationPreviews={...current.index[idx].allAnimationPreviews,...update.allAnimationPreviews};
  current.index[idx]=merged;
  const indexPath=`${current.basePath}/index.json`;fs.writeFileSync(indexPath,JSON.stringify(current.index,null,2));
  run('git',['add','--',indexPath]);
  try{await pushStaged('Publish verified Spine preview index metadata');pending.length=0;return;}
  catch(error){if(attempt===4)throw error;}
 }
}
const url=file=>`${origin}/assets/${workPath}/${file}`;
await publish({webmStatus:'ready',previewStatus:'ready',dispatchStatus:'ready',webmError:null,previewError:null,dispatchError:null,webmPreview:url('preview.webm'),webmPreviewMedium:url('preview-medium.webm'),webmPreviewLow:url('preview-low.webm'),webmPreviewPath:`${workPath}/preview.webm`,webpPoster:url('preview.webp'),webpPosterMedium:url('preview-medium.webp'),webpPosterLow:url('preview-low.webp'),previewWidth:meta.width,previewHeight:meta.height,previewDuration:meta.animationDuration,qualityWidths:meta.qualityWidths,defaultAnimation:meta.animation,animations:meta.animations,skeleton:meta.skeleton,atlas:meta.atlas,textures:meta.textures,webmGeneratedAt:new Date().toISOString()});
primaryPreviewPublished=true;
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
await publish({allAnimationPreviews:{...entryForUpload(process.cwd(),id).entry.allAnimationPreviews,[anim]:downloads},fullExportStatus:(meta.animations.length===1?'ready':'partial'),fullExportGeneratedAt:new Date().toISOString()});
report.status='ready';
report.code=null;
writeReport();
for (const targetId of new Set([id, ...(process.env.GITHUB_EVENT_NAME === 'push' ? (config.verifyUploadIds || []) : [])])) {
 const response=await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/dispatches`,{method:'POST',headers:{Authorization:`Bearer ${process.env.GITHUB_TOKEN}`,Accept:'application/vnd.github+json','Content-Type':'application/json'},body:JSON.stringify({event_type:'spine-export-full',client_payload:{uploadId:targetId,origin,owner:'vladleopold',repo:'spine',branch:'main'}})});
 if(!response.ok)throw Error('Full export dispatch failed: '+response.status);
}
console.log(JSON.stringify({ok:true,...report}));
