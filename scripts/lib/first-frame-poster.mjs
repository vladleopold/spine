import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

const FFMPEG_TIMEOUT_MS = 120000;
const RAW_FRAME_LIMIT = 256 * 1024 * 1024;

function dimensions(file) {
  const data = JSON.parse(execFileSync('ffprobe', [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height', '-of', 'json', file,
  ], { encoding: 'utf8', timeout: FFMPEG_TIMEOUT_MS, stdio: ['ignore', 'pipe', 'ignore'] }));
  const stream = data.streams?.[0];
  const width = Number(stream?.width || 0);
  const height = Number(stream?.height || 0);
  if (!(width > 0 && height > 0)) throw new Error('Video/poster has no readable dimensions');
  return { width, height };
}

function decodedFirstFrame(file) {
  return execFileSync('ffmpeg', [
    '-v', 'error', '-i', file, '-map', '0:v:0', '-frames:v', '1',
    '-f', 'rawvideo', '-pix_fmt', 'rgba', 'pipe:1',
  ], {
    timeout: FFMPEG_TIMEOUT_MS,
    maxBuffer: RAW_FRAME_LIMIT,
    stdio: ['ignore', 'pipe', 'ignore'],
  });
}

/**
 * Verify that the WebP pixels are the first decoded frame of this WebM, allowing only one 8-bit code value of decoder color-conversion rounding.
 * No seek, frame scan, alternate still, or later-frame substitution is allowed.
 */
export function verifyPosterFirstFrame(videoPath, posterPath) {
  const videoSize = dimensions(videoPath);
  const posterSize = dimensions(posterPath);
  if (videoSize.width !== posterSize.width || videoSize.height !== posterSize.height) {
    throw new Error('Poster dimensions do not match its WebM');
  }
  const videoFrame = decodedFirstFrame(videoPath);
  const posterFrame = decodedFirstFrame(posterPath);
  // WebM and WebP decoders can round YUV↔RGB conversion by one 8-bit
  // code value even when WebP is lossless and was encoded from frame zero.
  // Permit only that conversion noise; a different/later frame still fails.
  let sameFrame = videoFrame.length > 0 && videoFrame.length === posterFrame.length;
  for (let i = 0; sameFrame && i < videoFrame.length; i += 1) {
    if (Math.abs(videoFrame[i] - posterFrame[i]) > 1) sameFrame = false;
  }
  if (!sameFrame) {
    throw new Error('WebP is not the same first frame of its paired WebM');
  }
  return { ...videoSize, bytes: fs.statSync(posterPath).size };
}

/**
 * Extract frame zero from the supplied WebM and encode only that frame as
 * lossless WebP. This intentionally preserves a black/transparent first frame
 * if that is what the original animation actually starts with.
 */
export function generateFirstFrameWebp(videoPath, posterPath) {
  fs.rmSync(posterPath, { force: true });
  // FFmpeg decodes the input and sends only frame zero directly to libwebp.
  // No timestamp seek, scan, intermediate still, or later-frame selection.
  execFileSync('ffmpeg', [
    '-y', '-v', 'error', '-i', videoPath, '-map', '0:v:0',
    '-frames:v', '1', '-c:v', 'libwebp', '-lossless', '1',
    '-quality', '100', posterPath,
  ], { timeout: FFMPEG_TIMEOUT_MS, stdio: ['ignore', 'ignore', 'pipe'] });
  if (!fs.existsSync(posterPath) || fs.statSync(posterPath).size < 32) {
    throw new Error('Could not encode the first WebM frame as WebP');
  }
  return verifyPosterFirstFrame(videoPath, posterPath);
}
