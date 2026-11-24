// Regression coverage: animation changes must also recalculate the SpinePlayer viewport.
import assert from 'node:assert/strict';
import { setPlayerAnimation } from './lib/player-animation.mjs';

const calls = [];
const player = {
  paused: true,
  animationState: {
    clearTracks() { calls.push('clearTracks'); },
  },
  setAnimation(name, loop) {
    calls.push({ name, loop });
    return { animation: { name } };
  },
};

const entry = setPlayerAnimation(player, 'blow_reveal_landscape');
assert.deepEqual(calls, [
  'clearTracks',
  { name: 'blow_reveal_landscape', loop: true },
]);
assert.equal(player.paused, false);
assert.equal(entry.animation.name, 'blow_reveal_landscape');

assert.throws(
  () => setPlayerAnimation({ animationState: { clearTracks() {} } }, 'idle'),
  /SpinePlayer\.setAnimation/,
);

import fs from 'node:fs';
const rendererSource = fs.readFileSync(new URL('./spine-export-webm.mjs', import.meta.url), 'utf8');
assert.ok(rendererSource.includes('setPlayerAnimation.toString()'),
  'the browser capture page must use the tested viewport-aware animation helper');
assert.equal((rendererSource.match(/animationState\\.setAnimation/g) || []).length, 0,
  'the capture renderer must not bypass SpinePlayer.setAnimation');

console.log('PASS animation changes update the SpinePlayer viewport');
