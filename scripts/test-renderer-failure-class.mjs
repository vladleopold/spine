import assert from 'node:assert/strict';
import { classifyRendererError } from './renderer-failure-class.mjs';

assert.equal(classifyRendererError('TypeError: Cannot read properties of undefined'), 'SCRIPT_NULL_PROPERTY_ACCESS');
assert.equal(classifyRendererError('TypeError: animationData.map is not a function'), 'SCRIPT_COLLECTION_SHAPE');
assert.equal(classifyRendererError('TypeError: clearTracks is not a function'), 'SCRIPT_METHOD_UNAVAILABLE');
assert.equal(classifyRendererError('SPINE_PLAYER_LOAD_ERROR'), 'SPINE_RUNTIME_INITIALIZATION');
assert.equal(classifyRendererError('PLAYER_SCRIPT_TYPE_ERROR'), 'SCRIPT_RUNTIME');
console.log('PASS sanitized Spine renderer error classification');
