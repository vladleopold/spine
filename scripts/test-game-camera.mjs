import assert from 'node:assert/strict';
import { parseGameCamera, shouldUseGameCamera } from './lib/game-camera.mjs';

assert.deepEqual(
  parseGameCamera('1920x1080'),
  { width: 1920, height: 1080 },
  'explicit game camera dimensions must parse from the workflow setting',
);
assert.equal(
  parseGameCamera('1920-by-1080'),
  null,
  'invalid game camera dimensions must be rejected',
);

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
  shouldUseGameCamera({ width: 3000, height: 1600 }, camera, false),
  true,
  'a scene wider than the game viewport must retain native game-camera framing',
);
assert.equal(
  shouldUseGameCamera({ width: 900, height: 2522 }, camera, false),
  false,
  'a tall portrait character must not be cropped by the default landscape game camera',
);

assert.equal(
  shouldUseGameCamera({ width: 1800, height: 4000 }, { width: 1080, height: 1920 }, false),
  true,
  'large portrait game scenes must be framed by a compatible portrait camera',
);
assert.equal(
  shouldUseGameCamera({ width: 900, height: 2522 }, { width: 1080, height: 1920 }, true),
  true,
  'an explicitly configured camera must override automatic aspect-ratio detection',
);
