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

export function verifyPosterFirstFrame(videoPath, posterPath) {
  const videoSize = dimensions(videoPath);
  const posterSize = dimensions(posterPath);
  if (videoSize.width !== posterSize.width || videoSize.height !== posterSize.height) {
    throw new Error('Poster dimensions do not match its WebM');
  }
  const videoFrame = decodedFirstFrame(videoPath);
  const posterFrame = decodedFirstFrame(posterPath);
  let sameFrame = videoFrame.length > 0 && videoFrame.length === posterFrame.length;
  let maxDelta = 0;
  let differingChannels = 0;
  for (let i = 0; sameFrame && i < videoFrame.length; i += 1) {
    const delta = Math.abs(videoFrame[i] - posterFrame[i]);
    if (delta > maxDelta) maxDelta = delta;
    if (delta > 1) {
      differingChannels += 1;
      sameFrame = false;
    }
  }
  if (!sameFrame) {
    throw new Error('WebP is not the same first frame of its paired WebM' +
      ' (maxDelta=' + maxDelta + ', differingChannels=' + differingChannels + ')');
  }
  return { ...videoSize, bytes: fs.statSync(posterPath).size };
}

export function generateFirstFrameWebp(videoPath, posterPath) {
  fs.rmSync(posterPath, { force: true });
  const framePath = path.join(
    path.dirname(posterPath),
    '.first-frame-' + process.pid + '-' + Date.now() + '.png',
  );
  fs.rmSync(framePath, { force: true });
  try {
    execFileSync('ffmpeg', [
      '-y', '-v', 'error', '-i', videoPath, '-map', '0:v:0',
      '-frames:v', '1', '-pix_fmt', 'rgba', framePath,
    ], { timeout: FFMPEG_TIMEOUT_MS, stdio: ['ignore', 'ignore', 'pipe'] });
    if (!fs.existsSync(framePath) || fs.statSync(framePath).size < 32) {
      throw new Error('Could not decode the first WebM frame as RGBA PNG');
    }
    execFileSync('ffmpeg', [
      '-y', '-v', 'error', '-i', framePath, '-frames:v', '1',
      '-c:v', 'libwebp', '-lossless', '1', '-quality', '100', posterPath,
    ], { timeout: FFMPEG_TIMEOUT_MS, stdio: ['ignore', 'ignore', 'pipe'] });
  } finally {
    fs.rmSync(framePath, { force: true });
  }
  if (!fs.existsSync(posterPath) || fs.statSync(posterPath).size < 32) {
    throw new Error('Could not encode the first WebM frame as WebP');
  }
  return verifyPosterFirstFrame(videoPath, posterPath);
}
