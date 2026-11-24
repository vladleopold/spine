#!/usr/bin/env node
// Release-gate diagnostic: emits no source names, archive paths, image pixels
// or raw browser console messages. Only stable error categories and counts.
import fs from "node:fs";

export function classifyRendererError(text) {
  const x=String(text||"").toLowerCase();
  if(x.includes("unsupported_spine_3_7_binary_skeleton")||x.includes("spine player 3.7 requires jsonurl"))return "UNSUPPORTED_SPINE_3_7_BINARY_SKELETON";
  if(x.includes("unsupported_spine_export_3_8_75"))return "UNSUPPORTED_SPINE_EXPORT_VERSION";
  if (x.includes("couldn't load texture atlas page")||x.includes("couldn't load image")||x.includes("assets could not be loaded")||x.includes("could not load atlas")||x.includes("failed to fetch atlas")||x.includes("texture atlas page")) return "ATLAS_TEXTURE_LOAD";
  if (x.includes("region not set")||x.includes("could not find atlas region")) return "ATLAS_REGION_MISSING";
  if ((x.includes("enoent")||x.includes("no such file or directory")||x.includes("file not found")) &&
      /library(?:_\d+)?\/[^'"]+\.(?:json|skel|atlas(?:\.txt)?|png|jpe?g|webp|dds|astc|ktx2?)(?=['"\s]|$)/i.test(x)) return "SOURCE_GRAPH_MISSING";
  if (x.includes("unknown format")||x.includes("unsupported skeleton")||x.includes("unsupported spine")) return "SKELETON_RUNTIME_VERSION";
  if (x.includes("animation")&&(x.includes("not found")||x.includes("invalid")||x.includes("does not exist"))) return "ANIMATION_SELECTION";
  if (x.includes("skeleton")&&x.includes("not found")||x.includes("no spine sets found")||x.includes("missing required files")||x.includes("atlas file missing")) return "SOURCE_GRAPH_MISSING";
  if (x.includes("net::err_")||x.includes("failed to load resource")||x.includes("networkidle")||x.includes("could not resolve host")) return "NETWORK_ASSET";
  if (x.includes("timed out waiting for player ready")||x.includes("waiting for player ready")||x.includes("waitforfunction")&&x.includes("timeout")) return "PLAYER_INITIALIZATION_TIMEOUT";
  if (x.includes("no source animation produced visible changing frames")||
      x.includes("no skin produced visible content")||x.includes("no visible real-time spine frames")||
      x.includes("no visible pixels from the selected default spine skin")||
      x.includes("frame peak=0")||x.includes("rendered no visible content")) return "NO_VISIBLE_PIXEL";
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
  if (x.includes("cannot open input")||x.includes("error opening input")||(x.includes("no such file or directory")&&x.includes("ffmpeg"))) return "FFMPEG_INPUT_MISSING";
  if (x.includes("webp is not the same first frame")) return "POSTER_FRAME_MISMATCH";
  if (x.includes("webp generation failed")) return "WEBP_POSTER_FAILURE";
  if (x.includes("ffmpeg processing failed")||x.includes("command failed: ffmpeg")||x.includes("conversion failed")) return "FFMPEG_UNCLASSIFIED";
  return "NONE";
}

export function summarizeRendererLog(text) {
  const log=String(text||"");
  const lastCause=[...log.matchAll(/Capture(?: with skin [^\r\n]+)? failed:\s*([^\r\n]+)/g)].at(-1)?.[1]||"";
  const secondary=lastCause?classifyRendererError(lastCause):"NONE";
  const classifiedLog=classifyRendererError(log);
  const reason=classifiedLog==="OTHER_RENDER_FAILURE"&&secondary!=="NONE"?secondary:classifiedLog;
  const version=log.match(/Skeleton:\s*.*?\s+\(v(\d+\.\d+(?:\.\d+)?(?:-[a-z0-9.-]+)?)\)/i)?.[1]||"unknown";
  const sourceDefaultSkin=/SOURCE_SKIN_MODE=default|Skin \(default\):/i.test(log);
  const skinFallbackLine=log.match(/SOURCE_DECLARED_SKIN_FALLBACK=([^\\r\\n]*)/i)?.[1]||"";
  const skinFallbackCount=skinFallbackLine.split(",").map(x=>x.trim()).filter(Boolean).length;
  const recordingStarted=/RECORDER_STATE=recording|recorder recording/i.test(log);
  const attempts=sourceDefaultSkin?1+skinFallbackCount:(log.match(/Skin candidates:/g)||[]).length;
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
  const sourceGraphMissing=/ENOENT:\s*no such file or directory,\s*open\s+/i.test(log)||
    /missing required files|no spine sets found|atlas file missing/i.test(log);
  const ffmpegFailure=sourceGraphMissing?"NONE":classifyFfmpegFailure(log);
  // Source-graph and atlas blockers take precedence over FFmpeg's generic
  // ENOENT classification. A missing hydrated skeleton/atlas is not an
  // encoder failure, even when FFmpeg is the component that notices it.
  const sourceBlocker=new Set(["SOURCE_GRAPH_MISSING","ATLAS_TEXTURE_LOAD","ATLAS_REGION_MISSING",
    "SKELETON_RUNTIME_VERSION","UNSUPPORTED_SPINE_EXPORT_VERSION",
    "UNSUPPORTED_SPINE_3_7_BINARY_SKELETON"]).has(reason) &&
    !(ffmpegFailure==="FFMPEG_INPUT_MISSING" && /ffmpeg/i.test(log));
  const runtimeInitFailure=/spineplayer is not a function/i.test(log)?"SPINE_PLAYER_GLOBAL_MISSING":
    /player creation failed/i.test(log)?"PLAYER_CREATION_FAILED":"NONE";
  const distinctError=sourceBlocker?reason:ffmpegFailure!=="NONE"?ffmpegFailure:
    /no frame with visible content in the clip/i.test(log)?"POSTER_NO_VISIBLE_FRAMES":
    /could not.*(file|path)|no such file/i.test(log)?"MISSING_RENDER_INPUT":
    /timeout|timed out/i.test(log)?"RENDER_TIMEOUT":
    /No visible real-time Spine frames/i.test(log)?"COMPOSITED_FRAMES_NOT_VISIBLE":
    /Selected animation has no changing canvas frames/i.test(log)?"COMPOSITED_FRAMES_IDENTICAL":
    /Spine runtime generated blank deterministic frames/i.test(log)?"DETERMINISTIC_WEBM_BLANK":
    /Recovered canvas animation is missing encoded frames/i.test(log)?"DETERMINISTIC_WEBM_TRUNCATED":
    /No video data captured by MediaRecorder/i.test(log)?"MEDIARECORDER_NO_BLOB":
    /No visible pixels from any available Spine skin/i.test(log)?"RUNTIME_ALL_SKINS_INVISIBLE":
    /Cannot establish playable animation duration/i.test(log)?"UNKNOWN_ANIMATION_DURATION":
    /No frame with visible content/i.test(log)?"DECODED_FRAMES_INVISIBLE":
    reason==="SPINE_RUNTIME_INITIALIZATION"?(runtimeInitFailure!=="NONE"?runtimeInitFailure:"SPINE_RUNTIME_INITIALIZATION"):
    reason==="ANIMATION_SELECTION"?"ANIMATION_SELECTION":
    reason==="SOURCE_GRAPH_MISSING"?"SOURCE_GRAPH_MISSING":
    reason==="SKELETON_RUNTIME_VERSION"?"SKELETON_RUNTIME_VERSION":
    reason==="UNSUPPORTED_SPINE_EXPORT_VERSION"?"UNSUPPORTED_SPINE_EXPORT_VERSION":
    reason==="UNSUPPORTED_SPINE_3_7_BINARY_SKELETON"?"UNSUPPORTED_SPINE_3_7_BINARY_SKELETON":
    reason==="ATLAS_TEXTURE_LOAD"?"ATLAS_TEXTURE_LOAD":
    reason==="ATLAS_REGION_MISSING"?"ATLAS_REGION_MISSING":
    reason==="NO_VISIBLE_PIXEL"?"COMPOSITED_FRAMES_NOT_VISIBLE":
    "UNCLASSIFIED";
  const peaks=[...log.matchAll(/frame peak=([0-9.-]+)/gi)].map(x=>Number(x[1])).filter(Number.isFinite);
  const canvasSizes=[...log.matchAll(/canvas=(\d+)x(\d+)/gi)]
    .map(x=>[Number(x[1]),Number(x[2])]).slice(-8);
  const capturedVp9Bytes=[...log.matchAll(/MediaRecorder recording:\s*[^\n]*\((\d+) bytes\)/gi)]
    .map(x=>Number(x[1])).at(-1)||0;
  const skinSelectionMode=sourceDefaultSkin?(skinFallbackCount>0?"source-default+named-fallback":"source-default"):"unknown";
  const sourceSignal=log.includes("NO_VISIBLE_SPINE_FRAME")?"NO_RENDERED_SPINE_PIXELS":
    /No visible real-time Spine frames/i.test(log)?"CANVAS_FALLBACK_NO_VISIBLE_FRAMES":
    log.includes("High quality uses original VP9 recording")?"WEBM_SOURCE_AVAILABLE":"UNKNOWN";
  return {ok:false,reason,secondary,version,attempts,stages,distinctError,ffmpegFailure,runtimeInitFailure,skinFallbackCount,
    peaks:peaks.slice(-8),canvasSizes,skinSelectionMode,capturedVp9Bytes,sourceSignal};
}

if(process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop()) && process.argv.length>2){
  const log=fs.readFileSync(process.argv[2],"utf8");
  console.log("SANITIZED_RENDER_RESULT="+JSON.stringify(summarizeRendererLog(log)));
}
