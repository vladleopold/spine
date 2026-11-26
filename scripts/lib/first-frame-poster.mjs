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

export function frameDifferenceMetrics(videoFrame, posterFrame) {
  if (!videoFrame?.length || videoFrame.length !== posterFrame?.length ||
      videoFrame.length % 4 !== 0) {
    throw new Error('WebP dimensions do not match the decoded first frame');
  }
  let maxDelta = 0;
  let totalDelta = 0;
  let highDeltaChannels = 0;
  for (let i = 0; i < videoFrame.length; i += 4) {
    const videoAlpha = videoFrame[i + 3] / 255;
    const posterAlpha = posterFrame[i + 3] / 255;
    // RGB values beneath zero alpha are undefined and visually irrelevant.
    // Compare premultiplied RGB so transparent-edge codec noise cannot reject
    // an otherwise faithful WebP poster; compare alpha independently.
    for (let channel = 0; channel < 3; channel += 1) {
      const videoVisible = Math.round(videoFrame[i + channel] * videoAlpha);
      const posterVisible = Math.round(posterFrame[i + channel] * posterAlpha);
      const delta = Math.abs(videoVisible - posterVisible);
      if (delta > maxDelta) maxDelta = delta;
      totalDelta += delta;
      if (delta > 16) highDeltaChannels += 1;
    }
    const alphaDelta = Math.abs(videoFrame[i + 3] - posterFrame[i + 3]);
    if (alphaDelta > maxDelta) maxDelta = alphaDelta;
    totalDelta += alphaDelta;
    if (alphaDelta > 16) highDeltaChannels += 1;
  }
  return {
    maxDelta,
    meanDelta: totalDelta / videoFrame.length,
    highDeltaRatio: highDeltaChannels / videoFrame.length,
  };
}

export function isPosterFrameFaithful({ meanDelta, highDeltaRatio }) {
  return Number.isFinite(meanDelta) && Number.isFinite(highDeltaRatio) &&
    meanDelta <= 3.5 && highDeltaRatio <= 0.025;
}

export function verifyPosterFirstFrame(videoPath, posterPath) {
  const videoSize = dimensions(videoPath);
  const posterSize = dimensions(posterPath);
  if (videoSize.width !== posterSize.width || videoSize.height !== posterSize.height) {
    throw new Error('Poster dimensions do not match its WebM');
  }
  const videoFrame = decodedFirstFrame(videoPath);
  const posterFrame = decodedFirstFrame(posterPath);
  const metrics = frameDifferenceMetrics(videoFrame, posterFrame);
  const { maxDelta, meanDelta, highDeltaRatio } = metrics;
  // Card posters are deliberately lossy WebP for fast decode. Keep a strict
  // perceptual guard against a wrong/later frame while allowing codec noise.
  // A single isolated edge pixel may differ substantially in a lossy alpha
  // encode while remaining visually imperceptible. Mean error and the share
  // of materially different channels are the perceptual rejection criteria.
  if (!isPosterFrameFaithful(metrics)) {
    throw new Error('WebP is not a faithful first frame of its paired WebM' +
      ' (maxDelta=' + maxDelta + ', meanDelta=' + meanDelta.toFixed(3) +
      ', highDeltaRatio=' + highDeltaRatio.toFixed(4) + ')');
  }
  return {
    ...videoSize,
    bytes: fs.statSync(posterPath).size,
    maxDelta,
    meanDelta: Number(meanDelta.toFixed(3)),
  };
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
      '-c:v', 'libwebp', '-lossless', '0', '-quality', '88',
      '-compression_level', '6', posterPath,
    ], { timeout: FFMPEG_TIMEOUT_MS, stdio: ['ignore', 'ignore', 'pipe'] });
  } finally {
    fs.rmSync(framePath, { force: true });
  }
  if (!fs.existsSync(posterPath) || fs.statSync(posterPath).size < 32) {
    throw new Error('Could not encode the first WebM frame as WebP');
  }
  return verifyPosterFirstFrame(videoPath, posterPath);
}
