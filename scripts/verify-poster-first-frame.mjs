#!/usr/bin/env node
import { verifyPosterFirstFrame } from './lib/first-frame-poster.mjs';
const [video, poster] = process.argv.slice(2);
if (!video || !poster) throw new Error('Usage: node verify-poster-first-frame.mjs <video.webm> <poster.webp>');
const result = verifyPosterFirstFrame(video, poster);
console.log('PASS exact WebP first frame', JSON.stringify(result));
