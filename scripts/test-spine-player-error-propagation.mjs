import assert from "node:assert/strict";
import fs from "node:fs";

const source = fs.readFileSync(new URL("../src/SpineApp.tsx", import.meta.url), "utf8");

assert.doesNotMatch(source, /patchAtlasAttachmentLoader/,
  "the application must not suppress missing atlas regions by returning null attachments");
assert.doesNotMatch(source, /__spinePatched/,
  "runtime patch state must not leak between Spine Player instances");
assert.doesNotMatch(source, /msg\.includes\("Region not set"\)|msg\.includes\("Region not found"\)/,
  "atlas/runtime errors must not be hidden from browser diagnostics");
assert.match(source, /\.catch\(\(runtimeError: unknown\) =>/,
  "player module failures must be handled with their original error");
assert.match(source, /runtimeError\.message/,
  "the visible player error must retain the runtime's diagnostic message");
assert.match(source, /success: \(player: SpinePlayerInstance\) =>/,
  "the player must retain its success lifecycle callback");
assert.match(source, /setAnimations\(names\)/,
  "the player must continue exposing the loaded animation list");

console.log("PASS Spine Player preserves atlas/runtime errors and reports diagnostics");
