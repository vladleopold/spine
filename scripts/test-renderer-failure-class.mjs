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
assert.equal(classifyFfmpegFailure("Error: ENOENT: no such file or directory, open 'library_02/missing/source.json'"), "NONE",
  "a missing Spine source file is not an FFmpeg input failure");
assert.equal(classifyFfmpegFailure("ffmpeg: No such file or directory while opening input"), "FFMPEG_INPUT_MISSING");


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
assert.equal(summary.attempts,1,"this diagnostic fixture contains one attempted source skin");
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

const noVisibleSourceTrack=summarizeRendererLog(
  "Skeleton: source (v4.1.24)\\nPLAYER_READY=1\\nCapture failed: No source animation produced visible changing frames"
);
assert.equal(noVisibleSourceTrack.reason,"NO_VISIBLE_PIXEL");
assert.equal(noVisibleSourceTrack.distinctError,"COMPOSITED_FRAMES_NOT_VISIBLE",
  "source-track discovery with no visible moving animation must be a blocked preview, not an unclassified renderer failure");

const invalidAnimationLog="Error: Animation 'missing-track' not found in skeleton";
const invalidAnimation=summarizeRendererLog(invalidAnimationLog);
assert.equal(classifyRendererError(invalidAnimationLog),"ANIMATION_SELECTION");
assert.equal(invalidAnimation.distinctError,"ANIMATION_SELECTION");

const missingAnimationExistsLog="Capture with skin (default) failed: Player creation failed: Error: animation 'missing-track' does not exist in skeleton.";
const missingAnimationExists=summarizeRendererLog(missingAnimationExistsLog);
assert.equal(classifyRendererError(missingAnimationExistsLog),"ANIMATION_SELECTION");
assert.equal(missingAnimationExists.distinctError,"ANIMATION_SELECTION",
  "a source animation missing from the skeleton must be marked as an invalid selected track, not a generic runtime failure");

const betaRuntimeLog="Skeleton: Ranger.json (v3.8.11-beta)\\nPlayer creation failed: spine.SpinePlayer is not a function";
const betaRuntime=summarizeRendererLog(betaRuntimeLog);
assert.equal(betaRuntime.version,"3.8.11-beta","version diagnostics retain supported beta suffixes");
assert.equal(betaRuntime.reason,"SPINE_RUNTIME_INITIALIZATION");
assert.equal(betaRuntime.runtimeInitFailure,"SPINE_PLAYER_GLOBAL_MISSING");
const namedSkinFallback=summarizeRendererLog(
  "Skeleton: source (v3.8.99)\\nSOURCE_SKIN_MODE=default\\nSOURCE_DECLARED_SKIN_FALLBACK=default,hero"
);
assert.equal(namedSkinFallback.skinFallbackCount,2);
assert.equal(namedSkinFallback.attempts,3);
assert.equal(namedSkinFallback.skinSelectionMode,"source-default+named-fallback");

assert.equal(betaRuntime.distinctError,"SPINE_PLAYER_GLOBAL_MISSING",
  "player initialization failures must not be hidden as unclassified");

const incompleteSourceLog="Error: skeleton file not found while loading atlas source";
const incompleteSource=summarizeRendererLog(incompleteSourceLog);
assert.equal(classifyRendererError(incompleteSourceLog),"SOURCE_GRAPH_MISSING");
assert.equal(incompleteSource.distinctError,"SOURCE_GRAPH_MISSING");

const missingAtlasRegionLog="Capture with skin (default) failed: Player creation failed: Error: Region not set.";
const missingAtlasRegion=summarizeRendererLog(missingAtlasRegionLog);
assert.equal(classifyRendererError(missingAtlasRegionLog),"ATLAS_REGION_MISSING");
assert.equal(missingAtlasRegion.distinctError,"ATLAS_REGION_MISSING",
  "a missing atlas region is a source-bundle blocker, not an unclassified runtime failure");

const missingSourceLog="Error: ENOENT: no such file or directory, open 'library_02/missing/source.json'";
const missingSource=summarizeRendererLog(missingSourceLog);
assert.equal(classifyRendererError(missingSourceLog),"SOURCE_GRAPH_MISSING");
assert.equal(missingSource.distinctError,"SOURCE_GRAPH_MISSING",
  "a missing hydrated source file is an incomplete source bundle, not a generic renderer failure");
const ffmpegMissingInput=summarizeRendererLog("ffmpeg: error opening input: No such file or directory");
assert.equal(ffmpegMissingInput.distinctError,"FFMPEG_INPUT_MISSING",
  "missing FFmpeg input must remain distinct from a missing hydrated Spine source");

const unsupportedRuntimeLog="Error: unsupported Spine skeleton version";
const unsupportedRuntime=summarizeRendererLog(unsupportedRuntimeLog);
assert.equal(classifyRendererError(unsupportedRuntimeLog),"SKELETON_RUNTIME_VERSION");
assert.equal(unsupportedRuntime.distinctError,"SKELETON_RUNTIME_VERSION");
const unsupported37Log="UNSUPPORTED_SPINE_3_7_BINARY_SKELETON: Spine Player 3.7 requires jsonUrl; binary .skel cannot be loaded without a same-work JSON skeleton.";
const unsupported37=summarizeRendererLog(unsupported37Log);
assert.equal(classifyRendererError(unsupported37Log),"UNSUPPORTED_SPINE_3_7_BINARY_SKELETON");
assert.equal(unsupported37.distinctError,"UNSUPPORTED_SPINE_3_7_BINARY_SKELETON",
  'Spine 3.7 binary-only input must have a stable blocker classification, never UNCLASSIFIED');

const unsupportedWebPlayerLog="UNSUPPORTED_SPINE_WEB_PLAYER_VERSION: No bundled Spine Web Player runtime supports Spine 2.1.27; use a matching supported Spine runtime before browser preview generation.";
const unsupportedWebPlayer=summarizeRendererLog(unsupportedWebPlayerLog);
assert.equal(classifyRendererError(unsupportedWebPlayerLog),"SKELETON_RUNTIME_VERSION");
assert.equal(unsupportedWebPlayer.distinctError,"SKELETON_RUNTIME_VERSION",
  'a source version without a bundled Web Player runtime must be a stable unsupported-runtime blocker, never UNCLASSIFIED');

const startupFailure=summarizeRendererLog(
  "Skeleton: source (v3.8.59)\nCapture with skin (default) failed: Timed out waiting for player ready"
);
assert.equal(startupFailure.stages.playerReady,false);
assert.equal(startupFailure.stages.recordingStarted,false);
assert.equal(startupFailure.skinSelectionMode,"unknown");
assert.equal(startupFailure.reason,"PLAYER_INITIALIZATION_TIMEOUT");
assert.equal(startupFailure.secondary,"PLAYER_INITIALIZATION_TIMEOUT",
  "the exact skin-capture failure must be classified even when the player never reaches its ready marker");

const canvasPass=summarizeRendererLog(
  "PLAYER_READY=1\nSOURCE_SKIN_MODE=default\nCANVAS_FALLBACK_CAPTURE=started\nREALTIME_CANVAS_CAPTURE_PASS VISIBLE_FRAMES=12 DISTINCT=12"
);
assert.equal(canvasPass.stages.canvasFallbackAttempted,true);
assert.equal(canvasPass.stages.canvasFallbackPassed,true);

const exporter=fs.readFileSync(new URL("./spine-export-webm.mjs",import.meta.url),"utf8");
assert.match(exporter,/console\.error\('PLAYER_READY=1'\)/);
assert.match(exporter,/console\.error\('SOURCE_SKIN_MODE=default'\)/);
assert.match(exporter,/console\.error\('RECORDER_STATE=recording'\)/);
assert.match(exporter,/console\.error\('CANVAS_FALLBACK_CAPTURE=started'\)/);
assert.match(exporter,/console\.error\('CANVAS_FALLBACK_CAPTURE=passed'\)/);
assert.ok(exporter.includes("const skinCandidates = [null]"), "try the source default first");
assert.ok(exporter.includes("configuredPreviewSkinCandidates(skinConfig)"), "use only skin names explicitly declared by the uploaded source config");
assert.ok(exporter.includes("const runtimeSkinNames = await page.evaluate"), "binary-only skeletons expose source skin names from their loaded runtime");
assert.match(exporter,/skinCandidates\.push\(normalizedName\)/,
  "runtime skins are tried only after the default skin produces no visible frame");
assert.match(exporter,/normalizedName\.toLowerCase\(\) !== 'default'/);
assert.match(exporter,/if \(args\.allowVisibleTrackFallback\)/);
assert.match(exporter,/candidatePeak >= FRAME_PEAK_MIN && changing[\s\S]*?targetAnimation = candidate/,
  "alternate source tracks are accepted only after visible motion is detected");
console.log("PASS renderer stage diagnostics distinguish player-ready from invisible source-default canvas and keep runtime skin fallback source-bound");
