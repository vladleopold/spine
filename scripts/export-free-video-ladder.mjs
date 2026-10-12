#!/usr/bin/env node
// Free export ladder for all users: MP4/H.264 (universal), WebM/VP9
// (Google/browser), optional MP4/HEVC (Apple), plus original source.
// No subscription gates. Preserve timestamps: no speed-changing setpts.
import fs from 'node:fs';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
const [input, dir, ...flags] = process.argv.slice(2);
if (!input || !dir) throw Error('Usage: node scripts/export-free-video-ladder.mjs input.webm output-dir [--hevc]');
fs.mkdirSync(dir,{recursive:true});
const ff=(args,optional=false)=>{
 const result=spawnSync('ffmpeg',['-hide_banner','-loglevel','error','-y',...args],{stdio:'inherit'});
 if(result.status!==0 && !optional) throw Error('ffmpeg failed: '+args.join(' '));
 return result.status===0;
};
const source=path.resolve(input);
const probe=spawnSync('ffprobe',['-v','error','-select_streams','v:0','-show_entries','stream=width,height,avg_frame_rate','-of','json',source],{encoding:'utf8'});
if(probe.status!==0) throw Error('Cannot inspect source');
const info=JSON.parse(probe.stdout).streams?.[0];
if(!info?.width || !info?.height) throw Error('No video stream');
const tiers=[['original',null],['4k',3840],['2k',2560],['1080p',1920],['720p',1280],['480p',854]];
const unique=new Set();
const outputs=[];
for(const [label,maxWidth] of tiers){
 const width=maxWidth?Math.min(info.width,maxWidth):info.width;
 const w=Math.max(2,Math.round(width/2)*2);
 const h=Math.max(2,Math.round((info.height*w/info.width)/2)*2);
 const key=w+'x'+h;
 if(unique.has(key))continue;
 unique.add(key);
 const scale=['-vf',`scale=${w}:${h}:flags=lanczos`];
 const common=['-i',source,'-map','0:v:0','-an',...scale,'-fps_mode','passthrough','-movflags','+faststart'];
 const mp4=path.join(dir,`${label}-h264.mp4`);
 ff([...common,'-c:v','libx264','-preset','medium','-crf','19','-pix_fmt','yuv420p','-threads','16',mp4]);
 outputs.push({label,width:w,height:h,codec:'h264',path:mp4});
 const webm=path.join(dir,`${label}-vp9.webm`);
 ff(['-i',source,'-map','0:v:0','-an',...scale,'-fps_mode','passthrough','-c:v','libvpx-vp9','-crf','28','-b:v','0','-row-mt','1','-threads','16',webm]);
 outputs.push({label,width:w,height:h,codec:'vp9',path:webm});
 if(flags.includes('--hevc')){
  const hevc=path.join(dir,`${label}-hevc.mp4`);
  if(ff([...common,'-c:v','libx265','-preset','medium','-crf','23','-tag:v','hvc1','-pix_fmt','yuv420p','-threads','16',hevc],true))outputs.push({label,width:w,height:h,codec:'hevc',path:hevc});
 }
}
fs.writeFileSync(path.join(dir,'manifest.json'),JSON.stringify({source:input,sourceFps:info.avg_frame_rate,freeForEveryone:true,outputs},null,2)+'\n');
console.log('Generated '+outputs.length+' video renditions');
