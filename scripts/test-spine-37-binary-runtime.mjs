import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { runtimeVersionOverrideForSpineSkeleton, spinePlayerSourceBlocker } from './lib/spine-player-source-support.mjs';
import { resolveLocalSpinePlayerAssets } from './lib/spine-player-runtime-assets.mjs';

test('Spine 3.7 binary-only sources use the bundled 3.8 player instead of being blocked', () => {
  assert.equal(runtimeVersionOverrideForSpineSkeleton('3.7.93', 'hero.skel'), '3.8');
  assert.equal(spinePlayerSourceBlocker('3.7.93', 'hero.skel'), null);
  assert.equal(runtimeVersionOverrideForSpineSkeleton('3.7.93', 'hero.json'), '');
  assert.equal(spinePlayerSourceBlocker('3.7.93', 'hero.json'), null);
  assert.equal(runtimeVersionOverrideForSpineSkeleton('3.8.99', 'hero.skel'), '');
  assert.equal(spinePlayerSourceBlocker('3.8.99', 'hero.skel'), null);
  assert.equal(spinePlayerSourceBlocker('3.6.99', 'hero.skel').code, 'UNSUPPORTED_SPINE_WEB_PLAYER_VERSION');
});

test('the WebM exporter resolves 3.7 binary input through the 3.8 legacy runtime assets', () => {
  const exporter = fs.readFileSync(new URL('./spine-export-webm.mjs', import.meta.url), 'utf8');
  assert.match(exporter, /runtimeVersionOverrideForSpineSkeleton/);
  assert.match(exporter, /runtimeOverride[\s\S]{0,300}runtimeMinor/);
  const assets = resolveLocalSpinePlayerAssets({
    isLegacy: true,
    repoRoot: '/repo',
    versionMajor: '3',
    runtimeMinor: '8',
    playerJsUrl: 'https://spine-link.vercel.app/vendor-spine-player-3.8.js',
    playerCssUrl: 'https://spine-link.vercel.app/vendor-spine-player-3.8.css',
  });
  assert.equal(assets[0].filename, '/repo/public/vendor-spine-player-3.8.js');
  assert.equal(assets[1].filename, '/repo/public/vendor-spine-player-3.8.css');
});
