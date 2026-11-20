import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveLocalSpinePlayerAssets } from './lib/spine-player-runtime-assets.mjs';

test('pinned Spine 4.3 assets use only the isolated versioned runtime paths', () => {
  const root = path.join(os.tmpdir(), 'spine-player-runtimes');
  const jsUrl = 'https://cdn.example.test/spine-player.js';
  const cssUrl = 'https://cdn.example.test/spine-player.css';
  const assets = resolveLocalSpinePlayerAssets({
    isLegacy: false,
    versionedRuntimeRoot: root,
    modernRuntime: '4.3',
    repoRoot: '/repo',
    versionMajor: '4',
    runtimeMinor: '3',
    playerJsUrl: jsUrl,
    playerCssUrl: cssUrl,
  });
  assert.deepEqual(assets.map(asset => ({
    url: asset.url,
    filename: asset.filename,
    type: asset.type,
    required: asset.required,
  })), [
    {
      url: jsUrl,
      filename: path.join(root, 'spine-4.3', 'node_modules', '@esotericsoftware', 'spine-player', 'dist', 'iife', 'spine-player.js'),
      type: 'application/javascript',
      required: true,
    },
    {
      url: cssUrl,
      filename: path.join(root, 'spine-4.3', 'node_modules', '@esotericsoftware', 'spine-player', 'dist', 'spine-player.css'),
      type: 'text/css',
      required: true,
    },
  ]);
  assert.equal(new Set(assets.map(asset => asset.url)).size, 2,
    'the same CDN URL must never be checked first against an unversioned path');
  assert.ok(assets.every(asset => !asset.filename.includes(path.join('/repo', 'node_modules'))),
    '4.3 must not resolve through the unversioned root node_modules directory');

  const legacy = resolveLocalSpinePlayerAssets({
    isLegacy: true,
    repoRoot: '/repo',
    versionMajor: '3',
    runtimeMinor: '8',
    playerJsUrl: jsUrl,
    playerCssUrl: cssUrl,
  });
  assert.equal(legacy[0].filename, path.join('/repo', 'public', 'vendor-spine-player-3.8.js'));
  assert.equal(legacy.every(asset => asset.required === false), true,
    'legacy vendor files remain optional and may use their existing CDN path');

  assert.deepEqual(resolveLocalSpinePlayerAssets({
    isLegacy: false, modernRuntime: '4.3', playerJsUrl: jsUrl, playerCssUrl: cssUrl,
  }), [], 'without a pinned runtime root the existing CDN path remains available');

  const exporterSource = fs.readFileSync(new URL('./spine-export-webm.mjs', import.meta.url), 'utf8');
  assert.match(exporterSource, /resolveLocalSpinePlayerAssets/);
  assert.match(exporterSource, /if \(required\) throw new Error\('PINNED_SPINE_PLAYER_ASSET_MISSING_'/);
});
