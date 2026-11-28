import assert from "node:assert/strict";
import fs from "node:fs";
import {resolveSpinePlayerCanvas} from "./lib/spine-player-canvas.mjs";
import {shouldUseCanvasFallback,fallbackFrameCount,deterministicFallbackFps,shouldRecoverVisibleCanvas} from "./lib/canvas-fallback.mjs";
assert.equal(shouldUseCanvasFallback({bytes:2743,frames:1,fps:30,duration:2.2}),true);
assert.equal(shouldUseCanvasFallback({bytes:0,frames:0,fps:30,duration:1}),true);
assert.equal(shouldUseCanvasFallback({bytes:70000,frames:66,fps:30,duration:2.2}),false);
assert.equal(shouldUseCanvasFallback({bytes:12000,frames:4,fps:30,duration:8}),true);
assert.equal(shouldUseCanvasFallback({bytes:61095,frames:12,fps:30,duration:2}),true);
assert.equal(shouldUseCanvasFallback({bytes:215912,frames:55,fps:30,duration:2}),false);
assert.equal(fallbackFrameCount({fps:30,duration:0.3}),9);
assert.equal(fallbackFrameCount({fps:30,duration:2.2}),66);
assert.equal(fallbackFrameCount({fps:300,duration:200}),900);
assert.ok(fallbackFrameCount({fps:30,duration:2.2})>2);
console.log("PASS tiny MediaRecorder 2.7KB clip triggers frame recovery; real video bypasses recovery");
console.log("PASS fallback duration cap, frame count and safe bounds");

assert.equal(deterministicFallbackFps(30),15);
assert.equal(deterministicFallbackFps(60),15);
assert.equal(deterministicFallbackFps(15),15);
assert.equal(deterministicFallbackFps(12),12);
assert.equal(fallbackFrameCount({fps:deterministicFallbackFps(30),duration:30}),450);
console.log("PASS deterministic canvas recovery is bounded to 15fps and 450 frames for 30s previews");

assert.equal(shouldRecoverVisibleCanvas({alpha:false,peak:241,minPeak:40}),true);
assert.equal(shouldRecoverVisibleCanvas({alpha:false,peak:39,minPeak:40}),false);
assert.equal(shouldRecoverVisibleCanvas({alpha:true,peak:241,minPeak:40}),false);
console.log("PASS previously validated visible canvas survives a blank post-recorder readback");


const playerCanvas = {
  width: 960, height: 720,
  getContext() { return {}; },
  captureStream() { return {}; },
};
const domCanvas = {
  width: 960, height: 720,
  getContext() { return {}; },
  captureStream() { return {}; },
};
assert.deepEqual(
  resolveSpinePlayerCanvas({ canvas: playerCanvas }, { querySelector() { return domCanvas; } }),
  { canvas: playerCanvas, source: "player-property" },
);
assert.deepEqual(
  resolveSpinePlayerCanvas({}, { querySelector(selector) { return selector === "#player canvas" ? domCanvas : null; } }),
  { canvas: domCanvas, source: "player-dom" },
);
assert.deepEqual(
  resolveSpinePlayerCanvas({}, { querySelector(selector) { return selector === "canvas" ? domCanvas : null; } }),
  { canvas: domCanvas, source: "document-dom" },
);
assert.deepEqual(
  resolveSpinePlayerCanvas({}, { querySelector() { return null; } }),
  { canvas: null, source: "missing" },
);
const rendererSource = fs.readFileSync(new URL("./spine-export-webm.mjs", import.meta.url), "utf8");
assert.ok(rendererSource.includes("window.__resolveSpinePlayerCanvas"),
  "the capture page must serialize the tested player/DOM canvas resolver");
assert.ok(rendererSource.includes("SPINE_CAPTURE_INPUT="),
  "the renderer must log sanitized capture-input availability before MediaRecorder starts");
assert.ok(!rendererSource.includes("var c = player && player.canvas"),
  "frame inspection must use the same DOM-aware canvas resolver as recording");
assert.ok(!rendererSource.includes("!player.canvas"),
  "real-time frame recovery must not bypass the DOM-aware canvas resolver");
console.log("PASS Spine Player capture falls back to the real DOM canvas when player.canvas is unavailable");
