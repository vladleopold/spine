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
      uploadId: 'test-only',
      animation: selection.animation || null,
      status: selection.status === 'blocked' ? 'blocked' : 'rendering',
      code: selection.code || null,
      formats: [],
    };
    const target = path.join(directory, 'render-verification.json');
    writeRenderVerification(target, report);
    assert.deepEqual(JSON.parse(fs.readFileSync(target, 'utf8')), report);
    const renderWork = fs.readFileSync(new URL('./render-work.mjs', import.meta.url), 'utf8');
    assert.match(renderWork, /if\(selection\.status==='blocked'\)\s*\{\s*writeReport\(\);[\s\S]*?process\.exit\(1\);\s*\}/);
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
