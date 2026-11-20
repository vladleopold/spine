import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveRenderSelection, writeRenderVerification } from './lib/render-selection.mjs';
import { spinePlayerSourceBlocker } from './lib/spine-player-source-support.mjs';
import { resolveLocalSpinePlayerAssets } from './lib/spine-player-runtime-assets.mjs';

test('missing explicit and indexed animation is reported as blocked', () => {
  assert.deepEqual(resolveRenderSelection({}, { animations: ['idle', 'run'] }), {
    status: 'blocked', code: 'NO_DEFAULT_SPINE_ANIMATION', animation: '',
  });
});

test('explicit animation name is preserved even when absent from the source list', () => {
  const selected = resolveRenderSelection(
    { animation: 'Idle Post Climax Cum' },
    { defaultAnimation: 'run', animations: ['idle', 'run'] },
  );
  assert.deepEqual(selected, {
    status: 'selected', code: null, animation: 'Idle Post Climax Cum',
  });
});

test('indexed default is used only when no explicit animation was supplied', () => {
  assert.equal(resolveRenderSelection({ animation: '' }, { defaultAnimation: 'walk' }).animation, 'walk');
  assert.equal(resolveRenderSelection({ animation: 'run' }, { defaultAnimation: 'walk' }).animation, 'run');
});


test('blocked status is written as a diagnostic artifact before the workflow exits non-successfully', () => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'spine-render-report-'));
  try {
    const selection = resolveRenderSelection({}, {});
    const report = {
      status: selection.status === 'blocked' ? 'blocked' : 'rendering',
      code: selection.code || null,
      formats: [],
    };
    const target = path.join(directory, 'render-verification.json');
    writeRenderVerification(target, report);
    const written = JSON.parse(fs.readFileSync(target, 'utf8'));
    assert.deepEqual(written, report);
    assert.deepEqual(Object.keys(written).sort(), ['code', 'formats', 'status'],
      'public diagnostic artifacts must not expose work IDs or animation names');
    const renderWork = fs.readFileSync(new URL('./render-work.mjs', import.meta.url), 'utf8');
    const prepareRender = fs.readFileSync(new URL('./prepare-render.mjs', import.meta.url), 'utf8');
    assert.match(renderWork, /if\(selection\.status==='blocked'\)\s*\{\s*writeReport\(\);[\s\S]*?process\.exit\(1\);\s*\}/);
    assert.match(renderWork, /::add-mask::/);
    assert.match(prepareRender, /::add-mask::/);
    assert.doesNotMatch(renderWork, /report\.(?:uploadId|animation|error)|console\.error\(error\)/,
      'public logs and artifacts must not expose private IDs, animation names, or raw renderer errors');
    assert.match(renderWork, /SPINE_RENDER_FAILED=/);
  } finally {
    fs.rmSync(directory, { recursive: true, force: true });
  }
});


test('Spine 3.7 binary .skel is blocked before player creation; same-version JSON remains usable', () => {
  assert.deepEqual(spinePlayerSourceBlocker('3.7.93', 'skeleton.skel'), {
    code: 'UNSUPPORTED_SPINE_3_7_BINARY_SKELETON',
    message: 'Spine Player 3.7 requires jsonUrl; binary .skel cannot be loaded without a same-work JSON skeleton.',
  });
  assert.equal(spinePlayerSourceBlocker('3.7.93', 'skeleton.json'), null);
  assert.equal(spinePlayerSourceBlocker('3.8.99', 'skeleton.skel'), null);
  assert.equal(spinePlayerSourceBlocker('4.3.26', 'skeleton.skel'), null);
  const exporter = fs.readFileSync(new URL('./spine-export-webm.mjs', import.meta.url), 'utf8');
  assert.match(exporter, /const sourceBlocker = spinePlayerSourceBlocker\(skeletonVersion, skeletonFile\)/);
  assert.match(exporter, /if \(sourceBlocker\) \{[\s\S]*?process\.exit\(1\);[\s\S]*?\}/);
});


test('WebM exporter never substitutes an alternate or candidate animation', () => {
  const exporter = fs.readFileSync(new URL('./spine-export-webm.mjs', import.meta.url), 'utf8');
  const selector = fs.readFileSync(new URL('./preview-animation-choice.mjs', import.meta.url), 'utf8');
  assert.match(exporter, /const targetAnimation = choosePreviewAnimation\(availableAnimations, requestedAnimation\)/,
    'the renderer must receive only the exact requested/indexed animation');
  assert.ok(!exporter.includes('alternatePreviewAnimations'),
    'the exporter must not search alternate preview animations');
  assert.ok(!exporter.split(String.fromCharCode(10)).some(line =>
    line.includes('targetAnimation') && line.includes('candidate')),
    'no candidate animation may replace the selected animation');
  assert.match(selector, /return typeof preferred === 'string' \? preferred : ''/,
    'an unavailable explicit name must remain unchanged so the render can fail/ block');
});


test('latest-ten recovery exposes only numeric slots and sanitized metadata publicly', () => {
  const workflow = fs.readFileSync(new URL('../.github/workflows/repair-last-ten-previews.yml', import.meta.url), 'utf8');
  const repair = fs.readFileSync(new URL('./repair-last-ten-previews.mjs', import.meta.url), 'utf8');
  assert.ok(workflow.includes('name: validate-recovery-${{ matrix.entry.repairSlot }}'));
  assert.ok(workflow.includes('name: latest10-${{ matrix.entry.repairSlot }}'));
  assert.ok(workflow.includes('path: out/${{ matrix.entry.repairSlot }}/'));
  assert.ok(!workflow.includes('name: latest10-${{ matrix.entry.id }}'));
  assert.ok(!workflow.includes('/${{ matrix.entry.previewPath }}/'));
  assert.ok(workflow.includes('const safe={ok:true,animationMatches:true'));
  assert.ok(workflow.includes('Mask private source metadata and hydrate exact source'));
  assert.ok(workflow.includes('Mask and hydrate exact source directories'));
  assert.ok(repair.includes('latest.map((e,repairSlot)=>'));
  assert.ok(repair.includes('latest10-"+item.repairSlot'));
  assert.ok(repair.includes('meta?.animationMatches===true'));
  assert.ok(!repair.includes('meta.animations'),
    'render artifacts must not overwrite original animation names in index metadata');
});


test('published preview commits use generic messages without private IDs or source paths',()=>{
  const renderWork=fs.readFileSync(new URL('./render-work.mjs',import.meta.url),'utf8');
  const calls=renderWork.split(String.fromCharCode(10))
    .filter(line=>line.includes('pushStaged(')&&!line.includes('async function pushStaged'));
  assert.deepEqual(calls.map(line=>line.trim()),[
    "try{await pushStaged('Publish verified Spine preview media asset');break;}",
    "try{await pushStaged('Publish verified Spine preview index metadata');pending.length=0;return;}",
  ]);
  assert.ok(!renderWork.includes('Publish rendered asset'));
  assert.ok(!renderWork.includes('Publish verified media index for'));
});


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
