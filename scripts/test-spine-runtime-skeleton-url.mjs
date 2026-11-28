import assert from 'node:assert/strict';
import { resolveSpineRuntimeSkeletonUrl } from './lib/spine-runtime-skeleton-url.mjs';

const binaryUrl = 'https://raw.githubusercontent.com/vladleopold/spine/main/library_02/work/rig.skel';
const extractedUnityJsonUrl = 'https://raw.githubusercontent.com/vladleopold/spine/main/library_02/work/rig.skel';

assert.equal(
  resolveSpineRuntimeSkeletonUrl(extractedUnityJsonUrl, 'json'),
  extractedUnityJsonUrl + '.json',
  'Unity TextAsset JSON extracted from a .skel source must be served under a .json URL so Spine 4.2 selects SkeletonJson',
);
assert.equal(
  resolveSpineRuntimeSkeletonUrl(binaryUrl, 'binary'),
  binaryUrl,
  'real binary skeletons must retain their original .skel URL',
);
assert.equal(
  resolveSpineRuntimeSkeletonUrl('https://example.test/rig.json?v=abc', 'json'),
  'https://example.test/rig.json?v=abc',
  'native JSON URLs and immutable cache keys must remain unchanged',
);
assert.equal(
  resolveSpineRuntimeSkeletonUrl('https://example.test/rig.skel?v=abc', 'json'),
  'https://example.test/rig.skel.json?v=abc',
  'the synthetic JSON extension must be inserted before query strings',
);

console.log('SPINE_RUNTIME_SKELETON_URL_TESTS_PASS');
