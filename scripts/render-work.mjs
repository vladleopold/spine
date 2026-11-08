import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {execFileSync} from 'node:child_process';
import {entryForUpload} from './resolve-library.mjs';
const event=JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH,'utf8'));
const config=process.env.GITHUB_EVENT_NAME==='push'?JSON.parse(fs.readFileSync('scripts/render-check.json','utf8')):(event.client_payload||event.inputs||{});
const id=String(config.uploadId||'');
if(!/^[\w.-]+$/.test(id)||id.includes('..'))throw Error('Invalid upload ID');
const origin=new URL(config.origin||'https://spine-link.vercel.app').origin;
if(origin!=='https://spine-link.vercel.app')throw Error('Unsupported preview origin');
const found=entryForUpload(process.cwd(),id);if(!found)throw Error('Upload not found');
if (config.dispatchOnly === true && process.env.GITHUB_EVENT_NAME === 'push') {
  const response=await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/dispatches`,{method:'POST',headers:{Authorization:`Bearer ${process.env.GITHUB_TOKEN}`,Accept:'application/vnd.github+json','Content-Type':'application/json'},body:JSON.stringify({event_type:'spine-export-full',client_payload:{uploadId:id,origin,owner:'vladleopold',repo:'spine',branch:'main'}})});
  if(!response.ok)throw Error('Full export dispatch failed: '+response.status);
  console.log('Full export verification dispatched');process.exit(0);
}
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'spine-render-'));
const run=(cmd,args)=>execFileSync(cmd,args,{stdio:'inherit'});
const base=path.join(temp,'preview.webm');
const flags=[`--upload-id=${id}`,`--animation=${config.animation||found.entry.defaultAnimation||''}`,`--repo-path=${process.cwd()}`,`--origin=${origin}`,`--output=${base}`];
run('node',['scripts/spine-export-webm.mjs',...flags]);
const meta=JSON.parse(fs.readFileSync(base+'.json','utf8'));
const report={uploadId:id,animation:meta.animation,formats:[]};
process.on('uncaughtException',error=>{fs.writeFileSync('render-verification.json',JSON.stringify({...report,error:error.message},null,2));console.error(error);process.exit(1);});
function probe(file){
 const data=JSON.parse(execFileSync('ffprobe',['-v','error','-count_frames','-select_streams','v:0','-show_entries','stream=width,height,nb_read_frames,codec_name,pix_fmt:format=duration','-of','json',file],{encoding:'utf8'}));
 const s=data.streams[0];if(!s?.width||!Number(s.nb_read_frames))throw Error('Empty render: '+file);
 report.formats.push({file:path.basename(file),...s,duration:Number(data.format?.duration)});return s;
}
const pending=[];
const add=(src,dst)=>{if(!fs.existsSync(src)||fs.statSync(src).size===0)throw Error('Missing output '+src);pending.push({src,dst});};
const workPath=found.entry.previewPath||`${found.basePath}/${id}`;
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
   try{await pushStaged(`Publish rendered asset ${file.dst}`);break;}
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
  try{await pushStaged(`Publish verified media index for ${id}`);pending.length=0;return;}
  catch(error){if(attempt===4)throw error;}
 }
}
const url=file=>`${origin}/assets/${workPath}/${file}`;
await publish({webmStatus:'ready',webmError:null,webmPreview:url('preview.webm'),webmPreviewMedium:url('preview-medium.webm'),webmPreviewLow:url('preview-low.webm'),webmPreviewPath:`${workPath}/preview.webm`,webpPoster:url('preview.webp'),webpPosterMedium:url('preview-medium.webp'),webpPosterLow:url('preview-low.webp'),previewWidth:meta.width,previewHeight:meta.height,previewDuration:meta.animationDuration,qualityWidths:meta.qualityWidths,defaultAnimation:meta.animation,animations:meta.animations,skeleton:meta.skeleton,atlas:meta.atlas,textures:meta.textures,webmGeneratedAt:new Date().toISOString()});
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
  const dst=`${workPath}/animations/${safe}/${path.basename(file)}`;add(file,dst);downloads[key+cap]=`${origin}/assets/${dst}`;
 }
}
fs.writeFileSync('render-verification.json',JSON.stringify(report,null,2));
await publish({allAnimationPreviews:{...entryForUpload(process.cwd(),id).entry.allAnimationPreviews,[anim]:downloads},fullExportStatus:(meta.animations.length===1?'ready':'partial'),fullExportGeneratedAt:new Date().toISOString()});
for (const targetId of new Set([id, ...(process.env.GITHUB_EVENT_NAME === 'push' ? (config.verifyUploadIds || []) : [])])) {
 const response=await fetch(`https://api.github.com/repos/${process.env.GITHUB_REPOSITORY}/dispatches`,{method:'POST',headers:{Authorization:`Bearer ${process.env.GITHUB_TOKEN}`,Accept:'application/vnd.github+json','Content-Type':'application/json'},body:JSON.stringify({event_type:'spine-export-full',client_payload:{uploadId:targetId,origin,owner:'vladleopold',repo:'spine',branch:'main'}})});
 if(!response.ok)throw Error('Full export dispatch failed: '+response.status);
}
console.log(JSON.stringify({ok:true,...report}));
