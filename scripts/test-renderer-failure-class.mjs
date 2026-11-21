import assert from "node:assert/strict";
import fs from "node:fs";
import { classifyFfmpegFailure, classifyRendererError, summarizeRendererLog } from "./renderer-failure-class.mjs";

assert.equal(classifyFfmpegFailure("Unknown encoder 'libwebp'"), "FFMPEG_WEBP_ENCODER_UNAVAILABLE");
assert.equal(classifyFfmpegFailure("Unknown encoder 'libvpx-vp9'"), "FFMPEG_VP9_ENCODER_UNAVAILABLE");
assert.equal(classifyFfmpegFailure("No space left on device"), "FFMPEG_DISK_FULL");
assert.equal(classifyFfmpegFailure("Error while opening encoder for output stream"), "FFMPEG_OUTPUT_INITIALIZATION");
assert.equal(classifyFfmpegFailure("height not divisible by 2"), "FFMPEG_DIMENSION_CONSTRAINT");
assert.equal(classifyFfmpegFailure("Invalid data found when processing input"), "FFMPEG_INPUT_INVALID");
assert.equal(classifyFfmpegFailure("Resource temporarily unavailable"), "FFMPEG_RESOURCE_EXHAUSTED");
assert.equal(classifyFfmpegFailure("WebP is not the same first frame of its paired WebM"), "POSTER_FRAME_MISMATCH");
assert.equal(classifyFfmpegFailure("FFmpeg processing failed or skipped: Command failed"), "FFMPEG_UNCLASSIFIED");
assert.equal(classifyFfmpegFailure("ordinary render log"), "NONE");

const syntheticPrivateLog = [
  "FFmpeg command failed for /private/upload/secret-character/preview.webm",
  "Unknown encoder 'libwebp'",
  "FFmpeg processing failed or skipped",
].join("\n");
const safeCategory = classifyFfmpegFailure(syntheticPrivateLog);
assert.equal(safeCategory, "FFMPEG_WEBP_ENCODER_UNAVAILABLE");
assert.equal(JSON.stringify({ffmpegFailure:safeCategory}).includes("secret-character"), false);
console.log("PASS sanitized FFmpeg failure classification; no raw paths or asset names emitted");


const privateRenderLog=[
  "Skeleton: /private/source/secret-character/source.skel (v3.8.59)",
  "Animation: private-animation-name",
  "PLAYER_READY=1",
  "SOURCE_SKIN_MODE=default",
  "Skin (default): recorder recording",
  "RECORDER_STATE=recording",
  "CANVAS_FALLBACK_CAPTURE=started",
  "Error: No visible real-time Spine frames",
].join(String.fromCharCode(10));
const summary=summarizeRendererLog(privateRenderLog);
assert.equal(classifyRendererError(privateRenderLog),"NO_VISIBLE_PIXEL");
assert.equal(summary.reason,"NO_VISIBLE_PIXEL");
assert.equal(summary.distinctError,"COMPOSITED_FRAMES_NOT_VISIBLE");
assert.equal(summary.version,"3.8.59");
assert.equal(summary.attempts,1,"only the source default skin is attempted");
assert.equal(summary.skinSelectionMode,"source-default");
assert.equal(summary.stages.skeletonParsed,true);
assert.equal(summary.stages.playerReady,true,
  "a recording stage proves the player success callback completed");
assert.equal(summary.stages.recordingStarted,true);
assert.equal(summary.stages.canvasFallbackAttempted,true);
assert.equal(summary.stages.canvasFallbackPassed,false);
assert.equal(summary.sourceSignal,"CANVAS_FALLBACK_NO_VISIBLE_FRAMES");
assert.equal("selectedSkinCount" in summary,false,
  "do not report a fabricated zero when the exporter never enumerated skins");
assert.doesNotMatch(JSON.stringify(summary),/secret-character|private-animation-name|private\/source/,
  "sanitized diagnostics must not expose source paths or animation names");

const startupFailure=summarizeRendererLog(
  "Skeleton: source (v3.8.59)\nCapture with skin (default) failed: Timed out waiting for player ready"
);
assert.equal(startupFailure.stages.playerReady,false);
assert.equal(startupFailure.stages.recordingStarted,false);
assert.equal(startupFailure.skinSelectionMode,"unknown");
assert.equal(startupFailure.reason,"PLAYER_INITIALIZATION_TIMEOUT");

const canvasPass=summarizeRendererLog(
  "PLAYER_READY=1\nSOURCE_SKIN_MODE=default\nCANVAS_FALLBACK_CAPTURE=started\nREALTIME_CANVAS_CAPTURE_PASS VISIBLE_FRAMES=12 DISTINCT=12"
);
assert.equal(canvasPass.stages.canvasFallbackAttempted,true);
assert.equal(canvasPass.stages.canvasFallbackPassed,true);


const noTimeline = summarizeRendererLog(
  'PLAYER_READY=1\nRECORDER_STATE=recording\nCANVAS_FALLBACK_CAPTURE=started\n' +
  'Selected animation has no changing canvas frames\n' +
  'CANVAS_FALLBACK_DIAGNOSTICS='+JSON.stringify({
    samples:8,trackTimeDistinct:1,trackTimeRange:0,timelineCount:0,
    animationDuration:0,pausedSamples:0,visibleFrames:8,distinctFrames:1,
    canvasWidth:960,canvasHeight:720,selectedAnimation:'private-animation-name'
  })
);
assert.equal(noTimeline.distinctError,"SELECTED_ANIMATION_HAS_NO_TIMELINES");
assert.equal(noTimeline.sourceSignal,"SELECTED_ANIMATION_HAS_NO_TIMELINES");
assert.equal(noTimeline.canvasProgress.timelineCount,0);

const pausedCapture = summarizeRendererLog(
  'PLAYER_READY=1\nRECORDER_STATE=recording\nCANVAS_FALLBACK_CAPTURE=started\n' +
  'Selected animation has no changing canvas frames\n' +
  'CANVAS_FALLBACK_DIAGNOSTICS='+JSON.stringify({
    samples:8,trackTimeDistinct:1,trackTimeRange:0,timelineCount:4,
    animationDuration:1.5,pausedSamples:8,visibleFrames:8,distinctFrames:1,
    canvasWidth:960,canvasHeight:720
  })
);
assert.equal(pausedCapture.distinctError,"PLAYER_PAUSED_DURING_CAPTURE");

const stalledTrack = summarizeRendererLog(
  'PLAYER_READY=1\nRECORDER_STATE=recording\nCANVAS_FALLBACK_CAPTURE=started\n' +
  'Selected animation has no changing canvas frames\n' +
  'CANVAS_FALLBACK_DIAGNOSTICS='+JSON.stringify({
    samples:8,trackTimeDistinct:1,trackTimeRange:0,timelineCount:4,
    animationDuration:1.5,pausedSamples:0,visibleFrames:8,distinctFrames:1,
    canvasWidth:960,canvasHeight:720
  })
);
assert.equal(stalledTrack.distinctError,"ANIMATION_TRACK_TIME_STALLED");

const advancedStatic = summarizeRendererLog(
  'PLAYER_READY=1\nRECORDER_STATE=recording\nCANVAS_FALLBACK_CAPTURE=started\n' +
  'Selected animation has no changing canvas frames\n' +
  'CANVAS_FALLBACK_DIAGNOSTICS='+JSON.stringify({
    samples:8,trackTimeDistinct:8,trackTimeRange:0.875,timelineCount:6,
    animationDuration:1.5,pausedSamples:0,visibleFrames:8,distinctFrames:1,
    canvasWidth:960,canvasHeight:720
  })
);
assert.equal(advancedStatic.distinctError,"ANIMATION_TIME_ADVANCED_WITH_STATIC_PIXELS");
assert.equal(advancedStatic.canvasProgress.trackTimeDistinct,8);
assert.doesNotMatch(JSON.stringify(noTimeline),/private-animation-name/,
  "sanitized diagnostics must never return animation names or arbitrary metadata");

const exporter=fs.readFileSync(new URL("./spine-export-webm.mjs",import.meta.url),"utf8");
assert.match(exporter,/console\.error\('PLAYER_READY=1'\)/);
assert.match(exporter,/console\.error\('SOURCE_SKIN_MODE=default'\)/);
assert.match(exporter,/console\.error\('RECORDER_STATE=recording'\)/);
assert.match(exporter,/console\.error\('CANVAS_FALLBACK_CAPTURE=started'\)/);
assert.match(exporter,/CANVAS_FALLBACK_DIAGNOSTICS=/,
  "real-canvas failure logs must expose only sanitized track progress and frame counts");
assert.match(exporter,/console\.error\('CANVAS_FALLBACK_CAPTURE=passed'\)/);
assert.match(exporter,/const skinCandidates = Object\.freeze\(\[null\]\)/,
  "diagnostic markers must not enable alternate source skins");
assert.doesNotMatch(exporter,/alternatePreviewAnimations|targetAnimation\s*=\s*candidate/);
console.log("PASS renderer stage diagnostics distinguish player-ready from invisible source-default canvas without leaking source metadata");
