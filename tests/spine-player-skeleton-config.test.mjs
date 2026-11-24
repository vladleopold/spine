import test from 'node:test';
import assert from 'node:assert/strict';
import { spineSkeletonUrlConfig } from '../scripts/lib/spine-player-skeleton-config.mjs';

test('JSON skeletons use jsonUrl for the Spine Web Player', () => {
  assert.deepEqual(spineSkeletonUrlConfig('hero.json', '4.3.26', '/hero.json'), {
    jsonUrl: '/hero.json',
  });
});

test('Spine 3.8 binary skeletons use the legacy skelUrl option', () => {
  assert.deepEqual(spineSkeletonUrlConfig('hero.skel', '3.8.99', '/hero.skel'), {
    skelUrl: '/hero.skel',
  });
});

test('Spine 4.x binary skeletons use binaryUrl, not the obsolete skelUrl option', () => {
  for (const version of ['4.0.64', '4.1.24', '4.2.43', '4.3.26']) {
    assert.deepEqual(spineSkeletonUrlConfig('hero.skel', version, '/hero.skel'), {
      binaryUrl: '/hero.skel',
    });
  }
});

test('unsupported binary versions do not receive a guessed player URL property', () => {
  for (const version of ['2.1.27', '3.7.94', '5.0.0', 'unknown']) {
    assert.deepEqual(spineSkeletonUrlConfig('hero.skel', version, '/hero.skel'), {});
  }
});
