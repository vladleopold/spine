import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { resolveRenderSelection, writeRenderVerification } from './lib/render-selection.mjs';
import { spinePlayerSourceBlocker } from './lib/spine-player-source-support.mjs';

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


test('WebM exporter uses only the exact requested/indexed animation and source-default skin', () => {
  const exporter = fs.readFileSync(new URL('./spine-export-webm.mjs', import.meta.url), 'utf8');
  const selector = fs.readFileSync(new URL('./preview-animation-choice.mjs', import.meta.url), 'utf8');
  const repair = fs.readFileSync(new URL('./repair-latest-twenty-previews.mjs', import.meta.url), 'utf8');
  const workflow = fs.readFileSync(new URL('../.github/workflows/repair-latest-twenty-previews.yml', import.meta.url), 'utf8');
  assert.ok(exporter.includes('const targetAnimation = requestedAnimation;'));
  assert.ok(exporter.includes('NO_DEFAULT_SPINE_ANIMATION'));
  assert.ok(exporter.includes('SELECTED_SPINE_ANIMATION_UNAVAILABLE'));
  assert.ok(exporter.includes('const skinCandidates = [null];'));
  assert.ok(exporter.includes('window.__selectedAnimation = ${JSON.stringify(captureAnimation)};'));
  assert.ok(exporter.includes('SAME_ANIMATION_VISIBILITY_PROBES='));
  for (const token of ['__SPINE_AUTO__','allowVisibleTrackFallback','--allow-visible-track-fallback',
    'targetAnimation = candidate','skinCandidates.push','SOURCE_SKIN_FALLBACK'])
    assert.ok(!exporter.includes(token), 'unexpected exporter fallback: '+token);
  assert.ok(selector.includes("return typeof preferred === 'string' ? preferred : '';"));
  assert.ok(repair.includes('exactSelectedAnimation(record)'));
  assert.ok(!repair.includes('__SPINE_AUTO__'));
  assert.ok(!workflow.includes('ALLOW_VISIBLE_TRACK_FALLBACK'));
  assert.ok(!workflow.includes('--allow-visible-track-fallback'));
});

test('binary-only skeletons require the exact selected animation before rendering', () => {
  const exporter = fs.readFileSync(new URL('./spine-export-webm.mjs', import.meta.url), 'utf8');
  const repair = fs.readFileSync(new URL('./repair-latest-twenty-previews.mjs', import.meta.url), 'utf8');
  const workflow = fs.readFileSync(new URL('../.github/workflows/repair-latest-twenty-previews.yml', import.meta.url), 'utf8');
  assert.ok(repair.includes('MISSING_SOURCE_ANIMATION'));
  assert.ok(repair.includes('INVALID_DEFAULT_ANIMATION'));
  assert.ok(exporter.includes('const targetAnimation = requestedAnimation;'));
  assert.ok(!exporter.includes('runtimeAnimations.find'));
  assert.ok(!exporter.includes('window.__animationNames.find'));
  assert.ok(!workflow.includes('ALLOW_VISIBLE_TRACK_FALLBACK'));
  assert.ok(!workflow.includes('--allow-visible-track-fallback'));
  assert.ok(repair.includes('PREVIEW_RENDERER_REVISION="exact-track-and-default-skin-only-v6"'));
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
