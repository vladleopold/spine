import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { previewRuntimeMinor } from './lib/preview-runtime-minor.mjs';

test('detects every pinned Spine 4.x minor, including 4.3', () => {
  assert.equal(previewRuntimeMinor('4.0.31'), '4.0');
  assert.equal(previewRuntimeMinor('4.1.56'), '4.1');
  assert.equal(previewRuntimeMinor('4.2.120'), '4.2');
  assert.equal(previewRuntimeMinor('4.3.26'), '4.3');
  assert.equal(previewRuntimeMinor('3.8.99'), '');
  assert.equal(previewRuntimeMinor('unknown'), '');
});

test('reported-preview workflow uses the isolated pinned installer for all four 4.x minors', () => {
  const workflow = fs.readFileSync(new URL('../.github/workflows/repair-reported-previews.yml', import.meta.url), 'utf8');
  assert.ok(workflow.includes('^4\\.[0-3]$'));
  assert.ok(workflow.includes('bash scripts/install-pinned-spine-players.sh "$RUNNER_TEMP/spine-versioned" "$minor"'));
  assert.ok(!workflow.includes('npm install --no-save --no-audit --no-fund --prefix "$RUNNER_TEMP/spine-versioned"'));
});
