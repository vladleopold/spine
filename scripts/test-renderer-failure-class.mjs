import assert from 'node:assert/strict';
import { classifyRendererError, classifyRendererMethod } from './renderer-failure-class.mjs';

assert.equal(classifyRendererError('TypeError: Cannot read properties of undefined'), 'SCRIPT_NULL_PROPERTY_ACCESS');
assert.equal(classifyRendererError('TypeError: animationData.map is not a function'), 'SCRIPT_COLLECTION_SHAPE');
assert.equal(classifyRendererError('TypeError: clearTracks is not a function'), 'SCRIPT_METHOD_UNAVAILABLE');
assert.equal(classifyRendererError('SPINE_PLAYER_LOAD_ERROR'), 'SPINE_RUNTIME_INITIALIZATION');
assert.equal(classifyRendererError('PLAYER_SCRIPT_TYPE_ERROR'), 'SCRIPT_RUNTIME');
console.log('PASS sanitized Spine renderer error classification');


assert.equal(classifyRendererMethod('TypeError: player.animationState.clearTracks is not a function'), 'ANIMATION_STATE_CLEAR_TRACKS');
assert.equal(classifyRendererMethod('TypeError: player.animationState.setAnimation is not a function'), 'ANIMATION_STATE_SET_ANIMATION');
assert.equal(classifyRendererMethod('TypeError: canvas.captureStream is not a function'), 'CANVAS_CAPTURE_STREAM');
assert.equal(classifyRendererMethod('TypeError: canvas.toDataURL is not a function'), 'CANVAS_TO_DATA_URL');
assert.equal(classifyRendererMethod('TypeError: unknownMethod is not a function'), 'UNKNOWN_METHOD');
assert.equal(classifyRendererMethod('no renderer error'), 'NONE');
assert.equal(classifyRendererError('[BROWSER error] TypeError: clearTracks is not a function'), 'SCRIPT_METHOD_UNAVAILABLE');

const exporter = fs.readFileSync(new URL('./spine-export-webm.mjs', import.meta.url), 'utf8');
assert.ok(exporter.includes("window.addEventListener('unhandledrejection'"), 'async player rejections must be captured as sanitized failure signals');
assert.ok(exporter.includes('window.__captureError, null, { timeout: 60000, polling: 200 })', 'player-ready wait must pass Playwright options in the third argument');
assert.ok(exporter.includes('window.__videoData, null, { timeout: 15000 })', 'video-data wait must pass Playwright options in the third argument');
console.log('PASS case-insensitive browser diagnostics, safe method categories and Playwright wait options');
