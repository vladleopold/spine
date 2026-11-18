#!/usr/bin/env node
/** Salvage genuine, playable Spine WebM after a failed quality/poster stage.
 * Never invents or substitutes animation: requires 8+ decoded frames, visible
 * content and at least two distinct sampled frames before publishing.
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { entryForUpload } from './resolve-library.mjs';
const video = path.resolve(process.argv[2] || '');
const record = process.argv[4] ? entryForUpload(process.cwd(),process.argv[4])?.entry : null;
const animation = String(process.argv[3] || record?.defaultAnimation || record?.animations?.[0] || '').trim();
if (!video.endsWith('.webm') || !fs.existsSync(video) || fs.statSync(video).size < 1000) throw Error('No recorded WebM to recover');
const run=(cmd,args,opts={})=>execFileSync(cmd,args,{timeout:120000,maxBuffer:16*1024*1024,stdio:['ignore','pipe','pipe'],...opts});
const inspect=file=>JSON.parse(run('ffprobe',['-v','error','-count_frames','-show_entries','stream=width,height,nb_read_frames:format=duration','-select_streams','v:0','-of','json',file],{encoding:'utf8'}));
const info=inspect(video);
const stream=info.streams?.[0];
const width=Number(stream?.width)||0,height=Number(stream?.height)||0;
const frames=Number(stream?.nb_read_frames)||0;
const duration=Number(info.format?.duration)||0;
if(width<2||height<2||frames<8||!Number.isFinite(duration)||duration<=0)throw Error('Recorded WebM lacks a complete real animation');
const positions=[0,0.1,0.2,0.35,0.5,0.65,0.8,0.92].map(x=>Math.min(Math.max(0,duration-0.05),x*duration));
const samples=new Set();let chosen=null,nonblank=0;
for(const second of positions){
  let raw;
  try {
    raw=run('ffmpeg',['-v','error','-i',video,'-ss',String(second),'-frames:v','1','-vf','scale=48:48,format=gray','-f','rawvideo','-'],{maxBuffer:128*1024});
  } catch {continue;}
  if(raw.length!==48*48)continue;
  const bg=raw[0];let lit=0,different=0;
  for(const value of raw){if(value>24)lit++;if(Math.abs(value-bg)>=10)different++;}
  if(lit>=24||different>=12){
    nonblank++;samples.add(createHash('sha256').update(raw).digest('hex'));
    if(chosen===null)chosen=second;
  }
}
if(nonblank<2||samples.size<2||chosen===null)throw Error('Unverified, blank or static recorded Spine animation');
const base=video.replace(/\.webm$/i,'');
const dim=(scale)=>[Math.max(2,(Math.round(width*scale)&~1)),Math.max(2,(Math.round(height*scale)&~1))];
const widths={high:width,medium:dim(.66)[0],low:dim(.33)[0]};
for(const [quality,scale] of [['medium',.66],['low',.33]]){
  const out=base+'-'+quality+'.webm';
  if(fs.existsSync(out)&&fs.statSync(out).size>=1000)continue;
  const [w,h]=dim(scale);
  try{
    run('ffmpeg',['-y','-v','error','-i',video,'-an','-vf',`scale=${w}:${h}`,'-c:v','libvpx-vp9','-pix_fmt','yuv420p','-deadline','realtime','-cpu-used','8','-threads','4','-row-mt','1',out],{stdio:'inherit',timeout:180000});
  }catch{
    fs.copyFileSync(video,out);
    widths[quality]=width;
    console.error('RECOVERY_SOURCE_QUALITY_FOR_'+quality);
  }
}
for(const [quality,scale] of [['high',1],['medium',.66],['low',.33]]){
  const out=base+(quality==='high'?'':'-'+quality)+'.webp';
  if(fs.existsSync(out)&&fs.statSync(out).size>128)continue;
  const [w,h]=dim(scale);
  try{
    run('ffmpeg',['-y','-v','error','-i',video,'-ss',String(chosen),'-frames:v','1','-vf',`scale=${w}:${h}`,'-c:v','libwebp','-quality','90',out],{stdio:'inherit'});
  }catch{
    throw Error('Unable to encode real Spine poster: '+quality);
  }
}
const files={webmHigh:video,webmMedium:base+'-medium.webm',webmLow:base+'-low.webm',
webpHigh:base+'.webp',webpMedium:base+'-medium.webp',webpLow:base+'-low.webp'};
for(const [key,p] of Object.entries(files)){
  if(!fs.existsSync(p)||fs.statSync(p).size<=128)throw Error('Unverified recovery output '+key);
  if(key.startsWith('webm')){
    const pinfo=inspect(p);
    if(Number(pinfo.streams?.[0]?.nb_read_frames)<8)throw Error('Insufficient frames in recovered '+key);
  }
}
const media=fs.readFileSync(video);
const metaPath=video+'.json';
let previous={};
try{previous=JSON.parse(fs.readFileSync(metaPath,'utf8'))}catch{}
const metadata={...previous,animation:animation||previous.animation||'',animationDuration:duration,
width,height,bytes:media.length,sha256:createHash('sha256').update(media).digest('hex'),
qualityWidths:widths,files:Object.fromEntries(Object.entries(files).map(([key,p])=>[key,fs.statSync(p).size]))};
fs.writeFileSync(metaPath,JSON.stringify(metadata,null,2));
console.log('ACTUAL_SPINE_WEBM_RECOVERED',JSON.stringify({frames,width,height,distinctSamples:samples.size,
bytes:media.length,poster:metadata.files.webpHigh>128}));
