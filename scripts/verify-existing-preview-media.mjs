#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readIndex } from "./resolve-library.mjs";
import { previewSourceFingerprint, previewSourceBytesFingerprint } from "./repair-manifest-guard.mjs";
import { fingerprintPreviewMedia, hasWebmSignature, hasWebpSignature, previewMediaFailureReason, previewUrlMatches, safePreviewDirectory, selectedPreviewTiers } from "./lib/preview-media-validation.mjs";

const args = Object.fromEntries(process.argv.slice(2).filter(x => x.startsWith("--")).map(x => {
  const i = x.indexOf("="); return [x.slice(2, i), x.slice(i + 1)];
}));
const root = path.resolve(args["repo-path"] || process.cwd());
const slot = String(args.slot || "unknown").replace(/[^0-9]/g, "") || "unknown";
const output = args.output ? path.resolve(args.output) : "";
function writeMeta(value) {
  if (output) {
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify(value));
  }
}
function reject(reason, tierIndex = null) {
  writeMeta({ ok: false, existingVerified: false, reason, ...(tierIndex ? { tierIndex } : {}) });
  console.log("EXISTING_PREVIEW_MEDIA_NOT_VERIFIED slot=" + slot +
    (tierIndex ? " tier=" + tierIndex : "") + " reason=" + reason);
  process.exitCode = 2;
}
function probe(file) {
  return JSON.parse(execFileSync("ffprobe", [
    "-v", "error", "-count_frames", "-select_streams", "v:0",
    "-show_entries", "stream=nb_read_frames,width,height:format=duration",
    "-of", "json", file,
  ], { encoding: "utf8", timeout: 30000 }));
}

let stage = "IDENTITY";
let tierIndex = 0;
try {
  const basePath = String(args["base-path"] || "");
  const uploadId = String(args["upload-id"] || "");
  const animation = String(args.animation || "");
  const expectedPreviewPath = String(args["preview-path"] || "");
  if (!basePath || !uploadId || !animation || !expectedPreviewPath) reject("IDENTITY_ARGUMENT_MISSING");
  else {
    const record = (readIndex(root, basePath) || []).find(entry => entry?.id === uploadId);
    if (!record) reject("INDEX_RECORD_MISSING");
    else if (record.defaultAnimation !== animation || record.previewPath !== expectedPreviewPath || record.webmStatus !== "ready")
      reject("INDEX_MEDIA_NOT_READY_FOR_EXACT_ANIMATION");
    else {
      const tiers = selectedPreviewTiers(record, animation);
      const previewDir = safePreviewDirectory(root, record.previewPath);
      const mediaEntries = [];
      if (!tiers || !previewDir) reject("EXACT_MEDIA_MAPPING_MISSING");
      else {
        for (const [index, tier] of tiers.entries()) {
          tierIndex = index + 1;
          stage = "URL_MAPPING";
          if (!previewUrlMatches(tier.webmUrl, record.previewPath, tier.webmFile) ||
              !previewUrlMatches(tier.posterUrl, record.previewPath, tier.posterFile))
            throw new Error("MEDIA_URL_PATH_MISMATCH");
          const videoPath = path.join(previewDir, tier.webmFile);
          const posterPath = path.join(previewDir, tier.posterFile);
          stage = "MEDIA_READ";
          const video = fs.readFileSync(videoPath);
          const poster = fs.readFileSync(posterPath);
          if (video.length <= 128 || !hasWebmSignature(video)) throw new Error("WEBM_BYTES_INVALID");
          if (poster.length <= 128 || !hasWebpSignature(poster)) throw new Error("WEBP_BYTES_INVALID");
          mediaEntries.push([tier.webmFile, video], [tier.posterFile, poster]);
          stage = "WEBM_PROBE";
          const videoInfo = probe(videoPath);
          const stream = videoInfo.streams?.[0];
          const frames = Number(stream?.nb_read_frames || 0);
          const seconds = Number(videoInfo.format?.duration || 0);
          if (!(frames >= 8 && seconds >= 0.5 && frames / seconds >= 15 &&
              Number(stream?.width) > 0 && Number(stream?.height) > 0))
            throw new Error("WEBM_DECODE_OR_FRAME_DENSITY_FAILED");
          stage = "WEBP_PROBE";
          const posterInfo = probe(posterPath);
          const posterStream = posterInfo.streams?.[0];
          if (!(Number(posterStream?.width) > 0 && Number(posterStream?.height) > 0))
            throw new Error("WEBP_DECODE_FAILED");
          stage = "WEBP_DECODE";
          execFileSync("ffmpeg", ["-v", "error", "-i", posterPath, "-frames:v", "1", "-f", "null", "-"],
            { stdio: "ignore", timeout: 30000 });
          stage = "MOTION_VERIFY";
          execFileSync(process.execPath, [path.join(root, "scripts/verify-preview-motion.mjs"), videoPath],
            { stdio: "ignore", timeout: 150000 });
          stage = "POSTER_FIRST_FRAME";
          execFileSync(process.execPath, [path.join(root, "scripts/verify-poster-first-frame.mjs"), videoPath, posterPath],
            { stdio: "ignore", timeout: 150000 });
        }
        const animationHash = createHash("sha256").update(animation).digest("hex");
        const mediaFingerprint = fingerprintPreviewMedia(mediaEntries);
        writeMeta({ ok: true, existingVerified: true, animationMatches: true, animationHash, mediaFingerprint, tierCount: 3, sourceFingerprint: previewSourceFingerprint(record), sourceBytesFingerprint: previewSourceBytesFingerprint(root, record.previewPath) });
        console.log("EXISTING_PREVIEW_MEDIA_VERIFIED slot=" + slot + " tiers=3");
      }
    }
  }
} catch (error) {
  reject(previewMediaFailureReason(stage, error?.message), tierIndex);
}
