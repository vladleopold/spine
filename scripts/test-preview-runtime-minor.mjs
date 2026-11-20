import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { previewRuntimeMinor } from './lib/preview-runtime-minor.mjs';

const cli = fileURLToPath(new URL('./preview-runtime-minor.mjs', import.meta.url));

function varint(value) {
  const bytes = [];
  while (value >= 128) {
    bytes.push((value & 127) | 128);
    value >>>= 7;
  }
  bytes.push(value);
  return Buffer.from(bytes);
}

function text(value) {
  const bytes = Buffer.from(value, 'utf8');
  return Buffer.concat([varint(bytes.length + 1), bytes]);
}

test('detects every pinned Spine 4.x minor, including 4.3', () => {
  assert.equal(previewRuntimeMinor('4.0.31'), '4.0');
  assert.equal(previewRuntimeMinor('4.1.56'), '4.1');
  assert.equal(previewRuntimeMinor('4.2.120'), '4.2');
  assert.equal(previewRuntimeMinor('4.3.26'), '4.3');
  assert.equal(previewRuntimeMinor('3.8.99'), '');
  assert.equal(previewRuntimeMinor('unknown'), '');
});

test('CLI detects the 4.3 runtime from a binary skeleton header', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'preview-runtime-minor-skel-'));
  try {
    fs.writeFileSync(path.join(temp, 'character.skel'), Buffer.concat([text('hash'), text('4.3.26'), Buffer.alloc(32)]));
    const result = spawnSync(process.execPath, [cli, temp], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(result.stdout.trim(), '4.3');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('CLI detects the 4.3 runtime from a JSON skeleton header', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'preview-runtime-minor-json-'));
  try {
    fs.writeFileSync(path.join(temp, 'character.json'), JSON.stringify({ bones: [], skeleton: { spine: '4.3.26' } }));
    const result = spawnSync(process.execPath, [cli, temp], { encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.equal(result.stdout.trim(), '4.3');
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('reported-preview workflow uses the isolated pinned installer for all four 4.x minors', () => {
  const workflow = fs.readFileSync(new URL('../.github/workflows/repair-reported-previews.yml', import.meta.url), 'utf8');
  assert.ok(workflow.includes('^4\\.[0-3]$'));
  assert.ok(workflow.includes('bash scripts/install-pinned-spine-players.sh "$RUNNER_TEMP/spine-versioned" "$minor"'));
  assert.ok(!workflow.includes('npm install --no-save --no-audit --no-fund --prefix "$RUNNER_TEMP/spine-versioned"'));
});
