#!/usr/bin/env node
// Release-gate diagnostic: emits no source names, archive paths, image pixels
// or raw browser console messages. Only stable error categories and counts.
import fs from "node:fs";

export function classifyRendererError(text) {
  const x=String(text||"").toLowerCase();
  if(x.includes("unsupported_spine_export_3_8_75"))return "UNSUPPORTED_SPINE_EXPORT_VERSION";
  if (x.includes("couldn't load texture atlas page")||x.includes("couldn't load image")||x.includes("assets could not be loaded")||x.includes("could not load atlas")||x.includes("failed to fetch atlas")||x.includes("texture atlas page")) return "ATLAS_TEXTURE_LOAD";
  if (x.includes("unknown format")||x.includes("unsupported skeleton")||x.includes("unsupported spine")) return "SKELETON_RUNTIME_VERSION";
  if (x.includes("skeleton")&&x.includes("not found")||x.includes("no spine sets found")||x.includes("missing required files")||x.includes("atlas file missing")) return "SOURCE_GRAPH_MISSING";
  if (x.includes("animation")&&(x.includes("not found")||x.includes("invalid"))) return "ANIMATION_SELECTION";
  if (x.includes("net::err_")||x.includes("failed to load resource")||x.includes("networkidle")||x.includes("could not resolve host")) return "NETWORK_ASSET";
  if (x.includes("timed out waiting for player ready")||x.includes("waiting for player ready")||x.includes("waitforfunction")&&x.includes("timeout")) return "PLAYER_INITIALIZATION_TIMEOUT";
  if (x.includes("no skin produced visible content")||x.includes("no visible real-time spine frames")||x.includes("no visible pixels from the selected default spine skin")||x.includes("frame peak=0")||x.includes("rendered no visible content")) return "NO_VISIBLE_PIXEL";
  if (x.includes("no video data captured")||x.includes("mediarecorder failed")||x.includes("recorder")&&x.includes("error")) return "BROWSER_MEDIA_RECORDER";
  if (x.includes("webp generation failed")||x.includes("ffmpeg processing failed")||x.includes("invalid rendered video")) return "MEDIA_ENCODING";
  if (x.includes("spineplayer is not a function")||x.includes("player creation failed")) return "SPINE_RUNTIME_INITIALIZATION";
  if (x.includes("syntaxerror")||x.includes("unexpected token")||x.includes("referenceerror")||x.includes("typeerror")||x.includes("cannot read properties")) return "SCRIPT_RUNTIME";
  return "OTHER_RENDER_FAILURE";
}

// Parse only a fixed allow-list of FFmpeg failure classes. Never echo stderr:
// it may contain private source paths or asset names from a proprietary upload.
export function classifyFfmpegFailure(text) {
  const x=String(text||"").toLowerCase();
  if (x.includes("unknown encoder 'libwebp'")||x.includes('unknown encoder "libwebp"')||x.includes("libwebp encoder not found")||x.includes("libwebp not supported")) return "FFMPEG_WEBP_ENCODER_UNAVAILABLE";
  if (x.includes("unknown encoder 'libvpx-vp9'")||x.includes('unknown encoder "libvpx-vp9"')||x.includes("libvpx-vp9 encoder not found")||x.includes("libvpx-vp9 not supported")) return "FFMPEG_VP9_ENCODER_UNAVAILABLE";
  if (x.includes("no space left on device")||x.includes("disk quota exceeded")) return "FFMPEG_DISK_FULL";
  if (x.includes("cannot allocate memory")||x.includes("out of memory")||x.includes("resource temporarily unavailable")) return "FFMPEG_RESOURCE_EXHAUSTED";
  if (x.includes("width not divisible by 2")||x.includes("height not divisible by 2")||x.includes("not divisible by 2")) return "FFMPEG_DIMENSION_CONSTRAINT";
  if (x.includes("error while opening encoder")||x.includes("error initializing output stream")||x.includes("failed to initialize encoder")||x.includes("could not write header")) return "FFMPEG_OUTPUT_INITIALIZATION";
  if (x.includes("invalid data found when processing input")||x.includes("ebml header parsing failed")||x.includes("could not find codec parameters")) return "FFMPEG_INPUT_INVALID";
  if (x.includes("broken pipe")||x.includes("error writing trailer")||x.includes("error writing output")||x.includes("av_interleaved_write_frame")) return "FFMPEG_OUTPUT_WRITE";
  if (x.includes("no such file or directory")||x.includes("cannot open input")||x.includes("error opening input")) return "FFMPEG_INPUT_MISSING";
  if (x.includes("webp is not the same first frame")) return "POSTER_FRAME_MISMATCH";
  if (x.includes("webp generation failed")) return "WEBP_POSTER_FAILURE";
  if (x.includes("ffmpeg processing failed")||x.includes("command failed: ffmpeg")||x.includes("conversion failed")) return "FFMPEG_UNCLASSIFIED";
  return "NONE";
}

export function summarizeRendererLog(text) {
  const log=String(text||"");
  const reason=classifyRendererError(log);
  const version=log.match(/Skeleton:\s*.*?\s+\(v(\d+\.\d+(?:\.\d+)?)\)/i)?.[1]||"unknown";
  const lastCause=[...log.matchAll(/Capture failed:\s*([^\r\n]+)/g)].at(-1)?.[1]||"";
  const secondary=lastCause?classifyRendererError(lastCause):"NONE";
  const sourceDefaultSkin=/SOURCE_SKIN_MODE=default|Skin \(default\):/i.test(log);
  const recordingStarted=/RECORDER_STATE=recording|recorder recording/i.test(log);
  const attempts=sourceDefaultSkin?1:(log.match(/Skin candidates:/g)||[]).length;
  const stages={
    skeletonParsed:/Skeleton:/i.test(log),
    // Recording starts only after the player success callback has completed.
    playerReady:/PLAYER_READY=1|Skin candidates:/i.test(log)||recordingStarted,
    recordingStarted,
    webmWritten:/WebM saved:/i.test(log),
    qualityLadder:/Quality ladder:/i.test(log),
    posterGeneration:/Poster:|WebP \(high\)|WebP generation failed/i.test(log),
    canvasFallbackAttempted:/CANVAS_FALLBACK_CAPTURE=started|REALTIME_CANVAS_CAPTURE_PASS|No visible real-time Spine frames/i.test(log),
    canvasFallbackPassed:/CANVAS_FALLBACK_CAPTURE=passed|REALTIME_CANVAS_CAPTURE_PASS/i.test(log),
  };
  const ffmpegFailure=classifyFfmpegFailure(log);
  const diagnosticMatch=log.match(/CANVAS_FALLBACK_DIAGNOSTICS=(\{[^\r\n]*\})/);
  let canvasProgress=null;
  if(diagnosticMatch){
    try{
      const raw=JSON.parse(diagnosticMatch[1]);
      const safeInt=value=>Number.isSafeInteger(value)&&value>=0?value:null;
      const safeNumber=value=>Number.isFinite(value)?Number(value):null;
      canvasProgress={
        samples:safeInt(raw.samples),
        trackTimeDistinct:safeInt(raw.trackTimeDistinct),
        trackTimeRange:safeNumber(raw.trackTimeRange),
        timelineCount:safeInt(raw.timelineCount),
        animationDuration:safeNumber(raw.animationDuration),
        pausedSamples:safeInt(raw.pausedSamples),
        visibleFrames:safeInt(raw.visibleFrames),
        distinctFrames:safeInt(raw.distinctFrames),
        canvasWidth:safeInt(raw.canvasWidth),
        canvasHeight:safeInt(raw.canvasHeight),
      };
    }catch{}
  }
  const canvasFailure=canvasProgress?.timelineCount===0?"SELECTED_ANIMATION_HAS_NO_TIMELINES":
    canvasProgress?.samples>0&&canvasProgress.pausedSamples===canvasProgress.samples?"PLAYER_PAUSED_DURING_CAPTURE":
    canvasProgress?.trackTimeDistinct===0?"ANIMATION_TRACK_STATE_UNAVAILABLE":
    canvasProgress?.trackTimeDistinct===1?"ANIMATION_TRACK_TIME_STALLED":
    canvasProgress?.trackTimeDistinct>1&&canvasProgress.distinctFrames===1?"ANIMATION_TIME_ADVANCED_WITH_STATIC_PIXELS":"";
  const distinctError=ffmpegFailure!=="NONE"?ffmpegFailure:canvasFailure||
    (/no frame with visible content in the clip/i.test(log)?"POSTER_NO_VISIBLE_FRAMES":
    /could not.*(file|path)|no such file/i.test(log)?"MISSING_RENDER_INPUT":
    /timeout|timed out/i.test(log)?"RENDER_TIMEOUT":
    /No visible real-time Spine frames/i.test(log)?"COMPOSITED_FRAMES_NOT_VISIBLE":
    /Selected animation has no changing canvas frames/i.test(log)?"COMPOSITED_FRAMES_IDENTICAL":
    /Spine runtime generated blank deterministic frames/i.test(log)?"DETERMINISTIC_WEBM_BLANK":
    /Recovered canvas animation is missing encoded frames/i.test(log)?"DETERMINISTIC_WEBM_TRUNCATED":
    /No video data captured by MediaRecorder/i.test(log)?"MEDIARECORDER_NO_BLOB":
    /No visible pixels from any available Spine skin/i.test(log)?"RUNTIME_ALL_SKINS_INVISIBLE":
    /Cannot establish playable animation duration/i.test(log)?"UNKNOWN_ANIMATION_DURATION":
    /No frame with visible content/i.test(log)?"DECODED_FRAMES_INVISIBLE":"UNCLASSIFIED");
  const peaks=[...log.matchAll(/frame peak=([0-9.-]+)/gi)].map(x=>Number(x[1])).filter(Number.isFinite);
  const canvasSizes=[...log.matchAll(/canvas=(\d+)x(\d+)/gi)]
    .map(x=>[Number(x[1]),Number(x[2])]).slice(-8);
  const capturedVp9Bytes=[...log.matchAll(/MediaRecorder recording:\s*[^\n]*\((\d+) bytes\)/gi)]
    .map(x=>Number(x[1])).at(-1)||0;
  const skinSelectionMode=sourceDefaultSkin?"source-default":"unknown";
  const sourceSignal=canvasFailure||(
    log.includes("NO_VISIBLE_SPINE_FRAME")?"NO_RENDERED_SPINE_PIXELS":
    /No visible real-time Spine frames/i.test(log)?"CANVAS_FALLBACK_NO_VISIBLE_FRAMES":
    log.includes("High quality uses original VP9 recording")?"WEBM_SOURCE_AVAILABLE":"UNKNOWN");
  return {ok:false,reason,secondary,version,attempts,stages,distinctError,ffmpegFailure,
    peaks:peaks.slice(-8),canvasSizes,skinSelectionMode,capturedVp9Bytes,canvasProgress,sourceSignal};
}

if(process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop()) && process.argv.length>2){
  const log=fs.readFileSync(process.argv[2],"utf8");
  console.log("SANITIZED_RENDER_RESULT="+JSON.stringify(summarizeRendererLog(log)));
}
