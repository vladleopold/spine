#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
const exporter=fs.readFileSync(new URL('./spine-export-webm.mjs',import.meta.url),'utf8');
const repair=fs.readFileSync(new URL('./repair-latest-twenty-previews.mjs',import.meta.url),'utf8');
const helper=fs.readFileSync(new URL('./lib/first-frame-poster.mjs',import.meta.url),'utf8');
assert.match(exporter,/generateFirstFrameWebp\(source,\s*out\)/);
assert.doesNotMatch(exporter,/pickPosterFrame|frameHasContent|first frame was empty|using \$\{ss\}s instead/);
assert.match(helper,/-frames:v', '1'/);
assert.match(helper,/verifyPosterFirstFrame\(videoPath, posterPath\)/);
assert.match(helper,/videoFrame\.equals\(posterFrame\)/);
assert.doesNotMatch(helper,/\-ss|positions|pickPosterFrame|scan real timeline/);
assert.match(repair,/generateFirstFrameWebp/);
console.log('PASS posters: WebP is generated only from frame zero of its paired WebM');
