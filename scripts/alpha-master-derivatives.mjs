#!/usr/bin/env node
// Convert an existing lossless alpha master to transparent PNG frames,
// three optimized GIF sizes and a true native-size first-frame PNG.
// Source must already contain alpha. Never fabricate it from a black background.
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
const [input, outputDir] = process.argv.slice(2);
if (!input || !outputDir) throw new Error('Usage: node scripts/alpha-master-derivatives.mjs MASTER.mov OUTPUT_DIR');
fs.mkdirSync(outputDir,{recursive:true});
const run=(bin,args)=>execFileSync(bin,args,{stdio:'inherit',timeout:3600000});
const meta=JSON.parse(execFileSync('ffprobe',['-v','error','-select_streams','v:0','-show_entries','stream=pix_fmt,width,height,avg_frame_rate:format=duration','-of','json',input],{encoding:'utf8'}));
const stream=meta.streams?.[0];
if(!stream?.width || !stream?.height) throw new Error('Missing video stream');
const pix=String(stream.pix_fmt||'');
if(!/(yuva|rgba|bgra|argb|abgr|gbrap)/i.test(pix)) throw new Error('Master does not advertise alpha pixel format: '+pix);
const frames=path.join(outputDir,'frames');
fs.mkdirSync(frames,{recursive:true});
// Avoid implicit frame rate conversion; PNG numbering is deterministic.
run('ffmpeg',['-hide_banner','-loglevel','error','-y','-i',input,'-map','0:v:0','-vsync','0','-pix_fmt','rgba','-start_number','0',path.join(frames,'frame_%08d.png')]);
const first=path.join(frames,'frame_00000000.png');
if(!fs.existsSync(first)) throw new Error('First frame missing');
fs.copyFileSync(first,path.join(outputDir,'first-frame.png'));
const [n,d]=String(stream.avg_frame_rate||'30/1').split('/').map(Number);
const fps=n>0&&d>0?n/d:30;
// GIF has centisecond delays and max 256 palette colors. This is inherently
// lower fidelity than PNG; PNG remains the lossless interchange format.
for(const [name,scale] of [['large',1],['medium',0.67],['small',0.34]]){
  const width=Math.max(2,Math.round(stream.width*scale/2)*2);
  const filter=`fps=${Math.min(fps,50)},scale=${width}:-2:flags=lanczos,split[a][b];[a]palettegen=reserve_transparent=1:stats_mode=diff[p];[b][p]paletteuse=dither=sierra2_4a:alpha_threshold=64`;
  run('ffmpeg',['-hide_banner','-loglevel','error','-y','-threads','16','-i',input,'-filter_complex',filter,'-loop','0',path.join(outputDir,`preview-${name}.gif`)]);
}
fs.writeFileSync(path.join(outputDir,'manifest.json'),JSON.stringify({source:path.basename(input),width:stream.width,height:stream.height,fps,alpha:true,firstFrame:'first-frame.png',gif:['preview-large.gif','preview-medium.gif','preview-small.gif'],pngSequence:'frames/frame_%08d.png'},null,2)+'\n');
