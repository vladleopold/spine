import assert from "node:assert/strict";
import { classifyFfmpegFailure } from "./renderer-failure-class.mjs";

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
