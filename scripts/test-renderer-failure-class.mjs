import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawnSync } from "node:child_process";
import { classifyFfmpegFailure, classifyRendererError, summarizeRendererLog, readRendererLogSample, sanitizeRuntimeDiagnostics, readRendererLogExcerpt } from "./renderer-failure-class.mjs";

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
const safeRuntimeDiagnostics=sanitizeRuntimeDiagnostics({
  selectedAnimation:"private-animation-name",trackAnimation:"private-animation-name",trackTime:1.25,
  defaultSkin:"private-skin-name",skinNames:["default","private-skin-name"],activeSkin:"private-skin-name",
  attachedSlots:[{slot:"private-slot",attachment:"private-attachment",worldVertices:[1,2,3,4]}],
  bounds:{x:1,y:2,width:300,height:400},bones:[{name:"private-bone"}],
  atlasPages:[{name:"private-atlas-page",textureLoaded:true}],assetErrors:["/private/source/secret.png"],
  gl:{error:0,contextLost:false},canvas:{width:960,height:720},viewport:{x:1,y:2,width:300,height:400},
});
assert.equal(safeRuntimeDiagnostics.selectedAnimationPresent,true);
assert.equal(safeRuntimeDiagnostics.attachedSlotCount,1);
assert.equal(safeRuntimeDiagnostics.canvas.width,960);
assert.doesNotMatch(JSON.stringify(safeRuntimeDiagnostics),/private-animation-name|private-skin-name|private-slot|private-attachment|private-bone|private-atlas-page|secret\.png/);

const hugeLogDir=fs.mkdtempSync(path.join(os.tmpdir(),"spine-renderer-log-"));
const hugeLogPath=path.join(hugeLogDir,"renderer.log");
const hugeFd=fs.openSync(hugeLogPath,"w");
const hugeSize=600*1024*1024;
const hugeHead=Buffer.from("Skeleton: fixture (v3.8.59)\\nPLAYER_READY=1\\n");
const hugeTail=Buffer.from("Error: No visible real-time Spine frames\\n");
fs.writeSync(hugeFd,hugeHead,0,hugeHead.length,0);
fs.ftruncateSync(hugeFd,hugeSize);
fs.writeSync(hugeFd,hugeTail,0,hugeTail.length,hugeSize-hugeTail.length);
fs.closeSync(hugeFd);
const boundedLog=readRendererLogSample(hugeLogPath);
assert.ok(boundedLog.length<3*1024*1024,"large renderer logs must be sampled, not loaded into one unbounded string");
assert.match(boundedLog,/Skeleton: fixture/);
assert.match(boundedLog,/No visible real-time Spine frames/);
assert.equal(summarizeRendererLog(boundedLog).distinctError,"COMPOSITED_FRAMES_NOT_VISIBLE");
fs.rmSync(hugeLogDir,{recursive:true,force:true});

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
assert.ok(exporter.includes('window.__captureSpineFrame = function ()'),
  'deterministic fallback must read the actual WebGL drawing buffer');
assert.ok(exporter.includes("const dataUrl=await page.evaluate(()=>window.__captureSpineFrame?.()||'');"));
assert.ok(exporter.includes('DETERMINISTIC_CAPTURE_SOURCE=WEBGL_READPIXELS'));
assert.doesNotMatch(exporter,/canvasHost\.screenshot|page\.screenshot/);
assert.doesNotMatch(exporter,/SPINE_SCREENSHOT_JPEG_BASE64|diagnosticScreenshot/,
  "private preview pixels must never be embedded in public GitHub Actions logs");
assert.ok(exporter.includes("sanitizeRuntimeDiagnostics(runtimeDiagnostics)"),
  "runtime diagnostics must be reduced to safe counts and dimensions before logging");
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


{
  const root=fs.mkdtempSync(path.join(os.tmpdir(),"renderer-log-excerpt-"));
  try {
    const file=path.join(root,"renderer.log");
    fs.writeFileSync(file,"Skeleton: source (v4.3.26)\n"+"x".repeat(1024*1024)+"\nPRIVATE_MIDDLE_MARKER\n"+"x".repeat(1024*1024)+"\nError: No visible real-time Spine frames\n");
    const excerpt=readRendererLogExcerpt(file,256,64);
    assert.ok(Buffer.byteLength(excerpt)<=256,"diagnostic reader must cap bytes rather than materialize the full log");
    assert.ok(excerpt.includes("renderer log middle omitted"),"large logs must include an explicit truncation marker");
    assert.ok(excerpt.includes("Skeleton: source (v4.3.26)"),"the beginning of the log must retain the skeleton version");
    assert.match(excerpt,/No visible real-time Spine frames/,"the end of the log must retain the final failure");
    assert.doesNotMatch(excerpt,/PRIVATE_MIDDLE_MARKER/,"private middle content must not be copied into the diagnostic");
    const tinyExcerpt=readRendererLogExcerpt(file,16,16);
    assert.ok(Buffer.byteLength(tinyExcerpt)<=16,"small byte limits must never be exceeded by the truncation marker");
    const cli=spawnSync(process.execPath,[new URL("./renderer-failure-class.mjs",import.meta.url).pathname,file],{encoding:"utf8"});
    assert.equal(cli.status,0,cli.stderr);
    assert.match(cli.stdout,/SANITIZED_RENDER_RESULT=/,"the diagnostic CLI must run through the bounded reader");
    assert.match(cli.stdout,/"reason":"NO_VISIBLE_PIXEL"/,"the bounded CLI excerpt must retain the final actionable failure");
    assert.doesNotMatch(cli.stdout,/PRIVATE_MIDDLE_MARKER/,"the real CLI must not disclose private middle log content");
  } finally {
    fs.rmSync(root,{recursive:true,force:true});
  }
}
