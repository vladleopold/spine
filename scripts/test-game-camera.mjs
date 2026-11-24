import assert from 'node:assert/strict';
import { shouldUseGameCamera } from './lib/game-camera.mjs';

const camera = { width: 1920, height: 1080 };

assert.equal(
  shouldUseGameCamera({ width: 0, height: 0 }, camera, true),
  true,
  'an explicit landscape camera must be used when exported skeleton bounds are missing',
);
assert.equal(
  shouldUseGameCamera({ width: 1000, height: 800 }, camera, false),
  false,
  'ordinary bounds should retain automatic Spine Player framing',
);
assert.equal(
  shouldUseGameCamera({ width: 3000, height: 800 }, camera, false),
  true,
  'a scene wider than the game viewport must retain native game-camera framing',
);
assert.equal(
  shouldUseGameCamera({ width: 1000, height: 2000 }, camera, false),
  true,
  'a scene taller than the game viewport must retain native game-camera framing',
);

console.log('PASS explicit and bounds-driven game camera selection');
