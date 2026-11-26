import assert from "node:assert/strict";
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
console.log("PASS visible live Spine canvas is recoverable even if MediaRecorder returns no blob");
