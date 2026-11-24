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

console.log('PASS animation changes update the SpinePlayer viewport');
