import {execFileSync} from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {fileURLToPath} from 'node:url';

const scriptsDir=fileURLToPath(new URL('../',import.meta.url));
const motionVerifier=path.join(scriptsDir,'verify-preview-motion.mjs');
const posterVerifier=path.join(scriptsDir,'verify-poster-first-frame.mjs');
const FFMPEG_TIMEOUT_MS=120000;

function hasWebmMagic(bytes){
  return bytes.length>=4&&bytes[0]===0x1a&&bytes[1]===0x45&&bytes[2]===0xdf&&bytes[3]===0xa3;
}
function hasWebpMagic(bytes){
  return bytes.length>=12&&bytes.toString('ascii',0,4)==='RIFF'&&
    bytes.toString('ascii',8,12)==='WEBP';
}
function verifyDecodedPair(videoPath,posterPath){
  const probe=JSON.parse(execFileSync('ffprobe',[
    '-v','error','-count_frames','-select_streams','v:0',
    '-show_entries','stream=width,height,nb_read_frames:format=duration',
    '-of','json',videoPath,
  ],{encoding:'utf8',timeout:FFMPEG_TIMEOUT_MS,stdio:['ignore','pipe','ignore']}));
  const stream=probe.streams?.[0]||{};
  const width=Number(stream.width||0),height=Number(stream.height||0);
  const frames=Number(stream.nb_read_frames||0),duration=Number(probe.format?.duration||0);
  if(!(width>0&&height>0&&frames>=8&&duration>=0.5))
    throw new Error('Published WebM has insufficient decoded frames or duration');
  execFileSync(process.execPath,[motionVerifier,videoPath],{
    stdio:'ignore',timeout:FFMPEG_TIMEOUT_MS,
  });
  execFileSync(process.execPath,[posterVerifier,videoPath,posterPath],{
    stdio:'ignore',timeout:FFMPEG_TIMEOUT_MS,
  });
}

export async function verifyPublishedPreviewPair({
  videoUrl,
  posterUrl,
  expectedPrefix,
  expectedOrigin='https://spine-link.vercel.app',
  fetchImpl=globalThis.fetch,
  verifyFiles=verifyDecodedPair,
}={}){
  if(typeof fetchImpl!=='function'||typeof verifyFiles!=='function'||
    typeof expectedPrefix!=='string'||!expectedPrefix.startsWith('/assets/')||
    !expectedPrefix.endsWith('/'))return false;
  let video,poster;
  try{
    video=new URL(videoUrl);
    poster=new URL(posterUrl);
  }catch{return false;}
  if(video.origin!==expectedOrigin||poster.origin!==expectedOrigin||
    video.pathname!==expectedPrefix+'preview.webm'||
    poster.pathname!==expectedPrefix+'preview.webp')return false;

  let directory='';
  try{
    const [videoResponse,posterResponse]=await Promise.all([
      fetchImpl(video,{headers:{'Cache-Control':'no-cache'},signal:AbortSignal.timeout(60000)}),
      fetchImpl(poster,{headers:{'Cache-Control':'no-cache'},signal:AbortSignal.timeout(60000)}),
    ]);
    if(!videoResponse.ok||videoResponse.status!==200||
      !posterResponse.ok||posterResponse.status!==200)return false;
    const [videoBytes,posterBytes]=await Promise.all([
      videoResponse.arrayBuffer(),posterResponse.arrayBuffer(),
    ]);
    const videoBuffer=Buffer.from(videoBytes),posterBuffer=Buffer.from(posterBytes);
    if(videoBuffer.length<128||posterBuffer.length<32||
      !hasWebmMagic(videoBuffer)||!hasWebpMagic(posterBuffer))return false;

    directory=fs.mkdtempSync(path.join(os.tmpdir(),'spine-published-preview-'));
    const videoPath=path.join(directory,'preview.webm');
    const posterPath=path.join(directory,'preview.webp');
    fs.writeFileSync(videoPath,videoBuffer);
    fs.writeFileSync(posterPath,posterBuffer);
    const verified=await verifyFiles(videoPath,posterPath);
    return verified!==false;
  }catch{
    return false;
  }finally{
    if(directory)fs.rmSync(directory,{recursive:true,force:true});
  }
}
