#!/usr/bin/env node
// Independent proof against the published gallery. Download and decode full
// media bodies; never accept a 16 KiB prefix, metadata flag, or placeholder.
// Only aggregated counters are emitted: no source names, URLs, or pixels.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { previewSourceFingerprint } from './repair-manifest-guard.mjs';
import { verifyPosterFirstFrame } from './lib/first-frame-poster.mjs';

const repo='vladleopold/spine';
const snapshot=JSON.parse(process.env.REPAIR_IDS_JSON||'[]');
if(snapshot.length!==20)throw Error('Expected frozen snapshot of 20 works');
const token=process.env.GITHUB_TOKEN||'';
const headers={Accept:'application/vnd.github+json',...(token?{Authorization:'Bearer '+token}:{})};
const cache=new Map();
const maxMediaBytes=32*1024*1024;
const tempRoot=fs.mkdtempSync(path.join(os.tmpdir(),'spine-live-preview-'));
const fields=[
  {key:'webmPreview',type:'webm',file:'preview.webm',tier:'high'},
  {key:'webmPreviewMedium',type:'webm',file:'preview-medium.webm',tier:'medium'},
  {key:'webmPreviewLow',type:'webm',file:'preview-low.webm',tier:'low'},
  {key:'webpPoster',type:'webp',file:'preview.webp',tier:'high'},
  {key:'webpPosterMedium',type:'webp',file:'preview-medium.webp',tier:'medium'},
  {key:'webpPosterLow',type:'webp',file:'preview-low.webp',tier:'low'},
];
const tiers=[
  {suffix:'',video:'preview.webm',poster:'preview.webp'},
  {suffix:'-medium',video:'preview-medium.webm',poster:'preview-medium.webp'},
  {suffix:'-low',video:'preview-low.webm',poster:'preview-low.webp'},
];
async function getIndex(collection){
  if(cache.has(collection))return cache.get(collection);
  if(!/^library(?:_\d+)?$/.test(collection))throw Error('Unsafe collection');
  // The Contents API omits content for indexes larger than 1 MiB. Read the
  // public raw JSON directly so a large shard cannot become an empty snapshot.
  const rawUrl='https://raw.githubusercontent.com/'+repo+'/main/'+collection+'/index.json';
  const response=await fetch(rawUrl,{
    signal:AbortSignal.timeout(30000),cache:'no-store',
    headers:{'Cache-Control':'no-cache'},
  });
  if(!response.ok)throw Error('Cannot read current raw index '+response.status);
  const index=await response.json();
  if(!Array.isArray(index))throw Error('Invalid published index');
  cache.set(collection,index);
  return index;
}
async function exactMediaFilesExist(work){
  const dir=work.previewPath.split('/').map(encodeURIComponent).join('/');
  try{
    const response=await fetch('https://api.github.com/repos/'+repo+
      '/contents/'+dir+'?ref=main',{headers,
      signal:AbortSignal.timeout(30000),cache:'no-store'});
    if(!response.ok)return false;
    const body=await response.json();
    if(!Array.isArray(body))return false;
    const byName=new Map(body.map(x=>[x.name,Number(x.size||0)]));
    return fields.every(field=>(byName.get(field.file)||0)>128);
  }catch{return false;}
}
async function downloadMedia(mediaUrl,type,prefix,destination){
  let parsed;
  try{
    parsed=new URL(mediaUrl);
    if(parsed.origin!=='https://spine-link.vercel.app'||
       !parsed.pathname.startsWith(prefix))return null;
  }catch{return null;}
  for(let retry=0;retry<3;retry++){
    try{
      const response=await fetch(parsed,{
        headers:{'Cache-Control':'no-cache'},
        signal:AbortSignal.timeout(30000),cache:'no-store',
      });
      if(!response.ok)continue;
      const contentType=(response.headers.get('content-type')||'').toLowerCase();
      const expectedType=type==='webm'?'video/webm':'image/webp';
      if(!contentType.includes(expectedType))continue;
      const bytes=Buffer.from(await response.arrayBuffer());
      if(bytes.length<=128||bytes.length>maxMediaBytes)continue;
      if(type==='webm'){
        if(!bytes.subarray(0,4).equals(Buffer.from([0x1a,0x45,0xdf,0xa3])))continue;
      }else if(bytes.subarray(0,4).toString('ascii')!=='RIFF'||
          bytes.subarray(8,12).toString('ascii')!=='WEBP')continue;
      fs.writeFileSync(destination,bytes);
      return {bytes:bytes.length};
    }catch{}
    if(retry<2)await new Promise(resolve=>setTimeout(resolve,1500*(retry+1)));
  }
  return null;
}
function probeVideo(file){
  const parsed=JSON.parse(execFileSync('ffprobe',[
    '-v','error','-count_frames','-select_streams','v:0',
    '-show_entries','stream=width,height,nb_read_frames:format=duration',
    '-of','json',file,
  ],{encoding:'utf8',timeout:30000,stdio:['ignore','pipe','ignore']}));
  const stream=parsed.streams?.[0]||{};
  const result={width:Number(stream.width),height:Number(stream.height),
    frames:Number(stream.nb_read_frames),duration:Number(parsed.format?.duration)};
  if(!(result.width>0&&result.height>0&&result.frames>=8&&result.duration>=0.5))
    throw Error('WEBM_FRAME_OR_DURATION_REJECTED');
  return result;
}
function verifyMotion(file){
  execFileSync(process.execPath,[path.join(process.cwd(),'scripts/verify-preview-motion.mjs'),file],
    {stdio:'ignore',timeout:120000});
}
let ready=0,blocked=0,failed=0,verifiedMedia=0,mutatedSource=0;
let decodedVideos=0,exactPosterPairs=0;
try{
  for(let indexOfWork=0;indexOfWork<snapshot.length;indexOfWork++){
    const work=snapshot[indexOfWork];
    const slot=indexOfWork+1;
    let downloaded=0,decoded=0,paired=0,reason='MEDIA_DOWNLOAD_FAILED';
    try{
      const index=await getIndex(work.basePath);
      const matching=index.filter(entry=>entry.id===work.id);
      if(matching.length!==1){failed++;mutatedSource++;continue;}
      const record=matching[0];
      if(previewSourceFingerprint(record)!==work.sourceFingerprint){
        failed++;mutatedSource++;continue;
      }
      if(record.webmStatus==='blocked-missing-animation-selection'&&
         record.previewStatus==='blocked'&&!String(record.defaultAnimation||'').trim()){
        blocked++;
        continue;
      }
      if(record.webmStatus==='blocked-incompatible-source-version'){
        if(String(record.previewError||'').includes('Spine 3.8.75'))blocked++;
        else failed++;
        continue;
      }
      if(record.webmStatus==='blocked-missing-source'){
        const source=Array.isArray(record.files)?record.files:[];
        const triad=source.some(name=>/\.(skel|json)$/i.test(name))&&
          source.some(name=>/\.atlas(?:\.txt|\.docx)?$/i.test(name))&&
          source.some(name=>/\.(png|jpe?g|dds|webp)$/i.test(name));
        if(triad)failed++;else blocked++;
        continue;
      }
      if(record.webmStatus!=='ready'||record.previewStatus!=='ready'||
         !String(record.defaultAnimation||'').trim()||
         record.defaultAnimation!==work.animation){failed++;continue;}
      const selected=record.allAnimationPreviews?.[work.animation];
      if(!selected||selected.webmPreview!==record.webmPreview||
         selected.webmPreviewMedium!==record.webmPreviewMedium||
         selected.webmPreviewLow!==record.webmPreviewLow||
         selected.webpPoster!==record.webpPoster||
         selected.webpPosterMedium!==record.webpPosterMedium||
         selected.webpPosterLow!==record.webpPosterLow){failed++;continue;}
      if(!await exactMediaFilesExist(work)){failed++;continue;}
      const prefix='/assets/'+work.previewPath+'/';
      const dir=path.join(tempRoot,'slot-'+String(slot).padStart(2,'0'));
      fs.mkdirSync(dir,{recursive:true});
      const downloads=await Promise.all(fields.map(async field=>{
        const result=await downloadMedia(record[field.key],field.type,prefix,
          path.join(dir,field.file));
        if(result)downloaded++;
        return result;
      }));
      verifiedMedia+=downloaded;
      if(downloads.some(result=>!result)){reason='HTTP_BYTES_OR_MIME_REJECTED';throw Error(reason);}
      const probes={};
      for(const tier of tiers){
        const video=path.join(dir,tier.video);
        const poster=path.join(dir,tier.poster);
        probes[tier.suffix]=probeVideo(video);
        verifyMotion(video);
        decoded++;
        verifyPosterFirstFrame(video,poster);
        paired++;
      }
      if(!(probes[''].width>probes['-medium'].width&&
           probes['-medium'].width>probes['-low'].width)){
        reason='QUALITY_LADDER_REJECTED';
        throw Error(reason);
      }
      decodedVideos+=decoded;
      exactPosterPairs+=paired;
      ready++;
      console.log('PRODUCTION_MEDIA_EVIDENCE '+JSON.stringify({
        slot,ok:true,downloaded,decodedVideos:decoded,exactPosterPairs:paired,
        frameCounts:tiers.map(tier=>probes[tier.suffix].frames),
        distinctFrameRequirement:8,
      }));
    }catch(error){
      failed++;
      console.log('PRODUCTION_MEDIA_EVIDENCE '+JSON.stringify({
        slot,ok:false,downloaded,decodedVideos:decoded,exactPosterPairs:paired,
        reason:reason==='MEDIA_DOWNLOAD_FAILED'?'DECODE_OR_PAIR_MISMATCH':reason,
      }));
    }
  }
  const summary={total:snapshot.length,ready,blocked,failed,
    mediaVerified:verifiedMedia,expectedMedia:snapshot.length*fields.length,
    decodedVideos,exactPosterPairs,mutatedSource};
  console.log('LATEST20_PRODUCTION_MEDIA_AUDIT='+JSON.stringify(summary));
  if(failed||ready+blocked!==snapshot.length||verifiedMedia!==ready*fields.length||
     decodedVideos!==ready*tiers.length||exactPosterPairs!==ready*tiers.length)
    process.exitCode=1;
}finally{
  fs.rmSync(tempRoot,{recursive:true,force:true});
}
