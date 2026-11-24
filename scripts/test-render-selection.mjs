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


test('unsupported web-player versions and Spine 3.7 binary .skel are blocked before player creation', () => {
  assert.deepEqual(spinePlayerSourceBlocker('3.7.93', 'skeleton.skel'), {
    code: 'UNSUPPORTED_SPINE_3_7_BINARY_SKELETON',
    message: 'Spine Player 3.7 requires jsonUrl; binary .skel cannot be loaded without a same-work JSON skeleton.',
  });
  assert.deepEqual(spinePlayerSourceBlocker('2.1.27', 'skeleton.json'), {
    code: 'UNSUPPORTED_SPINE_WEB_PLAYER_VERSION',
    message: 'No bundled Spine Web Player runtime supports Spine 2.1.27; re-export with Spine 3.7+ before browser preview generation.',
  });
  assert.deepEqual(spinePlayerSourceBlocker('3.6.53', 'skeleton.json'), {
    code: 'UNSUPPORTED_SPINE_WEB_PLAYER_VERSION',
    message: 'No bundled Spine Web Player runtime supports Spine 3.6.53; re-export with Spine 3.7+ before browser preview generation.',
  });
  assert.deepEqual(spinePlayerSourceBlocker('unknown', 'skeleton.json'), {
    code: 'SPINE_VERSION_UNKNOWN',
    message: 'Spine export version could not be detected; the renderer will not guess a player runtime.',
  });
  assert.equal(spinePlayerSourceBlocker('3.7.93', 'skeleton.json'), null);
  assert.equal(spinePlayerSourceBlocker('3.8.99', 'skeleton.skel'), null);
  assert.equal(spinePlayerSourceBlocker('4.3.26', 'skeleton.skel'), null);
  const exporter = fs.readFileSync(new URL('./spine-export-webm.mjs', import.meta.url), 'utf8');
  assert.match(exporter, /const sourceBlocker = spinePlayerSourceBlocker\(skeletonVersion, skeletonFile\)/);
  assert.match(exporter, /if \(sourceBlocker\) \{[\s\S]*?process\.exit\(1\);[\s\S]*?\}/);
});


test('WebM exporter preserves requested tracks and only falls back to a visible changing source track when explicitly enabled', () => {
  const exporter = fs.readFileSync(new URL('./spine-export-webm.mjs', import.meta.url), 'utf8');
  const selector = fs.readFileSync(new URL('./preview-animation-choice.mjs', import.meta.url), 'utf8');
  assert.ok(exporter.includes("let targetAnimation = autoAnimation ? '' : (requestedAnimation && availableAnimations.includes(requestedAnimation)"),
    'the requested track remains the first candidate');
  assert.match(exporter, /allowVisibleTrackFallback: false/);
  assert.match(exporter, /if \(args\.allowVisibleTrackFallback\)/);
  assert.match(exporter, /window\.__frameSignature = function/);
  assert.match(exporter, /const candidates = \[targetAnimation, \.\.\.alternatives\.slice\(0, 7\)\]/);
  assert.match(exporter, /candidatePeak >= FRAME_PEAK_MIN && changing/);
  assert.match(exporter, /targetAnimation = candidate/);
  assert.match(exporter, /animationFallbackUsed: Boolean\(args\.allowVisibleTrackFallback && targetAnimation !== requestedAnimation\)/);
  assert.match(selector, /if \(typeof preferred === 'string' && preferred\.length > 0\) return preferred;/,
    'the source selector keeps the indexed default first; the renderer only changes previewAnimation after pixel/motion validation');
});


test('binary-only skeletons defer preview animation selection to the loaded Spine runtime', () => {
  const exporter = fs.readFileSync(new URL('./spine-export-webm.mjs', import.meta.url), 'utf8');
  const repair = fs.readFileSync(new URL('./repair-latest-twenty-previews.mjs', import.meta.url), 'utf8');
  const workflow = fs.readFileSync(new URL('../.github/workflows/repair-latest-twenty-previews.yml', import.meta.url), 'utf8');
  assert.match(repair, /sourceReady\?'__SPINE_AUTO__':''/);
  assert.match(exporter, /const autoAnimation = requestedAnimation === '__SPINE_AUTO__'/);
  assert.match(exporter, /window\.__animationNames\.find\(function\(name\) \{ return \/\^idle\$\/i\.test\(name\); \}\)/);
  assert.match(exporter, /const pinnedAnimation = autoAnimation[\s\S]*?choosePreviewAnimation\(runtimeAnimations, ''\)/);
  assert.match(workflow, /ALLOW_VISIBLE_TRACK_FALLBACK: "true"/);
  assert.match(workflow, /--allow-visible-track-fallback/);
  assert.match(workflow, /allowFallback\|\|expectedAnimation==="__SPINE_AUTO__"/);
  assert.match(workflow, /animationFallbackUsed:Boolean\(m\.animationFallbackUsed\)/);
  assert.match(repair, /meta\.animationFallbackUsed===true/);
  assert.match(repair, /PREVIEW_RENDERER_REVISION="auto-track-recovery-v6-runtime-skin-selection"/);
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


test('archive preview capture is bounded for pathological long source timelines', () => {
  const exporter = fs.readFileSync(new URL('./spine-export-webm.mjs', import.meta.url), 'utf8');
  assert.match(exporter, /const MAX_PREVIEW_CAPTURE_SECONDS = 30/);
  assert.match(exporter, /captureDuration = Math\.min\(effectiveDuration, MAX_PREVIEW_CAPTURE_SECONDS\)/);
  assert.match(exporter, /PREVIEW_CAPTURE_DURATION_CAPPED/);
});
