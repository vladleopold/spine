#!/usr/bin/env node
// Release-gate diagnostic: emits no source names, archive paths, image pixels
// or raw browser console messages. Only stable error categories and counts.
import fs from "node:fs";

export function classifyRendererError(text) {
  const x=String(text||"").toLowerCase();
  if(/unsupported_spine_export_3_8_75/.test(x))return "UNSUPPORTED_SPINE_EXPORT_VERSION";
  if (/couldn.t load texture atlas page|couldn.t load image|assets could not be loaded|could not load atlas|failed to fetch atlas|texture atlas page/.test(x)) return "ATLAS_TEXTURE_LOAD";
  if (/unknown format|unsupported .*skeleton|unsupported .*spine|unsupported spine/.test(x)) return "SKELETON_RUNTIME_VERSION";
  if (/skeleton.*not found|no spine sets found|missing required files|atlas file missing/.test(x)) return "SOURCE_GRAPH_MISSING";
  if (/animation .*not found|no animation found|invalid animation/.test(x)) return "ANIMATION_SELECTION";
  if (/net::err_|failed to load resource|networkidle|could not resolve host/.test(x)) return "NETWORK_ASSET";
  if (/timed out waiting for player ready|waiting for player ready|waitforfunction.*timeout/.test(x)) return "PLAYER_INITIALIZATION_TIMEOUT";
  if (/no skin produced visible content|frame peak=0|rendered no visible content/.test(x)) return "NO_VISIBLE_PIXEL";
  if (/no video data captured|mediarecorder failed|recorder.*error/.test(x)) return "BROWSER_MEDIA_RECORDER";
  if (/webp generation failed|ffmpeg processing failed|invalid rendered video/.test(x)) return "MEDIA_ENCODING";
  if (/spineplayer is not a function|player creation failed/.test(x)) return "SPINE_RUNTIME_INITIALIZATION";
  if (/syntaxerror|unexpected token|referenceerror|typeerror|cannot read properties/.test(x)) return "SCRIPT_RUNTIME";
  return "OTHER_RENDER_FAILURE";
}

if(process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop()) && process.argv.length>2){
  const log=fs.readFileSync(process.argv[2],"utf8");
  const reason=classifyRendererError(log);
  const version=log.match(/Skeleton:\s*.*?\s+\(v(\d+\.\d+(?:\.\d+)?)\)/i)?.[1]||"unknown";
  const lastCause=[...log.matchAll(/Capture failed:\s*([^\r\n]+)/g)].at(-1)?.[1]||"";
  const secondary=lastCause?classifyRendererError(lastCause):"NONE";
  const attempts=(log.match(/Skin candidates:/g)||[]).length;
  const stages={
    skeletonParsed:/Skeleton:/i.test(log),
    playerReady:/Skin candidates:/i.test(log),
    recordingStarted:/recorder recording|recorder recording/i.test(log),
    webmWritten:/WebM saved:/i.test(log),
    qualityLadder:/Quality ladder:/i.test(log),
    posterGeneration:/Poster:|WebP \(high\)|WebP generation failed/i.test(log),
  };
  const distinctError=/no frame with visible content in the clip/i.test(log)?"POSTER_NO_VISIBLE_FRAMES":
    /ffmpeg.*(encoder|unknown|invalid|failed)/i.test(log)?"FFMPEG_ENCODER_OR_INPUT":
    /could not.*(file|path)|no such file/i.test(log)?"MISSING_RENDER_INPUT":
    /webp.*failed/i.test(log)?"WEBP_POSTER_FAILURE":
    /timeout|timed out/i.test(log)?"RENDER_TIMEOUT":
    /No visible real-time Spine frames/i.test(log)?"COMPOSITED_FRAMES_NOT_VISIBLE":
    /Selected animation has no changing canvas frames/i.test(log)?"COMPOSITED_FRAMES_IDENTICAL":
    /Spine runtime generated blank deterministic frames/i.test(log)?"DETERMINISTIC_WEBM_BLANK":
    /Recovered canvas animation is missing encoded frames/i.test(log)?"DETERMINISTIC_WEBM_TRUNCATED":
    /No video data captured by MediaRecorder/i.test(log)?"MEDIARECORDER_NO_BLOB":
    /No visible pixels from any available Spine skin/i.test(log)?"RUNTIME_ALL_SKINS_INVISIBLE":
    /Cannot establish playable animation duration/i.test(log)?"UNKNOWN_ANIMATION_DURATION":
    /No frame with visible content/i.test(log)?"DECODED_FRAMES_INVISIBLE":
    "UNCLASSIFIED";
  const peaks=[...log.matchAll(/frame peak=([0-9.-]+)/gi)].map(x=>Number(x[1])).filter(Number.isFinite);
  const canvasSizes=[...log.matchAll(/canvas=(\d+)x(\d+)/gi)]
    .map(x=>[Number(x[1]),Number(x[2])]).slice(-8);
  const selectedSkinCount=[...log.matchAll(/Skin candidates:\s*(\[[^\n]*\])/g)]
    .map(x=>{try{return JSON.parse(x[1]).length;}catch{return 0;}}).at(-1)||0;
  const capturedVp9Bytes=[...log.matchAll(/MediaRecorder recording:\s*[^\n]*\((\d+) bytes\)/gi)]
    .map(x=>Number(x[1])).at(-1)||0;
  const sourceSignal=log.includes('NO_VISIBLE_SPINE_FRAME')?'NO_RENDERED_SPINE_PIXELS':
    log.includes('High quality uses original VP9 recording')?'WEBM_SOURCE_AVAILABLE':'UNKNOWN';
  console.log("SANITIZED_RENDER_RESULT="+JSON.stringify({ok:false,reason,secondary,version,attempts,
    stages,distinctError,peaks:peaks.slice(-8),canvasSizes,selectedSkinCount,capturedVp9Bytes,sourceSignal}));
}
