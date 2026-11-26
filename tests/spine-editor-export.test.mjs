import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { chmodSync, mkdtempSync, rmSync, writeFileSync, mkdirSync, realpathSync } from 'node:fs';
import { resolveLegacyImagesDirectory, parseMissingImagesPaths, runLicensedSpineExport } from '../scripts/spine-editor-export.mjs';

test('resolve stale project-relative image path inside the isolated workspace', () => {
  const workspaceRoot = '/workspace';
  const projectDir = '/workspace/storage/library_02/upload-123';
  const imagesDir = path.join(projectDir, 'images');
  assert.equal(
    resolveLegacyImagesDirectory({ projectDir, imagesDir, workspaceRoot,
      missingPath: '../../../SpineVersion/Spine_sample_01/images/' }),
    '/workspace/SpineVersion/Spine_sample_01/images',
  );
});

test('reject absolute, Windows and workspace-escaping image paths', () => {
  const args = { projectDir:'/workspace/storage/library_02/upload-123',
    imagesDir:'/workspace/storage/library_02/upload-123/images', workspaceRoot:'/workspace' };
  assert.throws(() => resolveLegacyImagesDirectory({ ...args, missingPath:'/Users/name/project/images' }), /absolute/);
  assert.throws(() => resolveLegacyImagesDirectory({ ...args, missingPath:'C:\\\\Users\\\\name\\\\images' }), /absolute/);
  assert.throws(() => resolveLegacyImagesDirectory({ ...args, missingPath:'../../../../tmp/images' }), /escapes/);
});

test('parse Editor image-path diagnostics without duplicate paths', () => {
  assert.deepEqual(parseMissingImagesPaths(`Images path not found: ../../../one/images/
Images path not found: ../../../one/images/
Images path not found: ../two/images/`),
  ['../../../one/images/', '../two/images/']);
});

test('rebind missing project images to uploaded images/ and retry the real CLI without changing source', () => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'spine-editor-export-'));
  try {
    const workspaceRoot = root;
    const projectDir = path.join(root, 'storage', 'library_02', 'fixture-123');
    const imagesDir = path.join(projectDir, 'images');
    const output = path.join(projectDir, 'export');
    mkdirSync(imagesDir, { recursive:true });
    writeFileSync(path.join(imagesDir, 'texture.png'), 'image');
    const project = path.join(projectDir, 'spine.spine');
    writeFileSync(project, 'original project bytes');
    const counter = path.join(root, 'calls.txt');
    const cli = path.join(root, 'fake-spine');
    writeFileSync(cli, `#!/usr/bin/env node
const fs = require('node:fs');
const path = require('node:path');
const out = process.argv[process.argv.indexOf('--output') + 1];
const counter = process.env.FAKE_SPINE_COUNTER;
const n = Number(fs.existsSync(counter) ? fs.readFileSync(counter, 'utf8') : 0) + 1;
fs.writeFileSync(counter, String(n));
if (n === 1) {
  console.error('Images path not found: ../../../SpineVersion/Spine_sample_01/images/');
  process.exit(0);
}
fs.mkdirSync(out, {recursive:true});
fs.writeFileSync(path.join(out,'spine.json'), JSON.stringify({skeleton:{spine:'4.3.26'},animations:{idle:{}}}));
fs.writeFileSync(path.join(out,'spine.atlas'), 'page.png\\nsize: 1,1\\nformat: RGBA8888\\nfilter: Linear,Linear\\nrepeat: none\\n');
fs.writeFileSync(path.join(out,'page.png'), 'png');
`);
    chmodSync(cli, 0o755);
    const original = fs.readFileSync(project);
    const result = runLicensedSpineExport({ cli, project, output, images:imagesDir,
      workspaceRoot, license:'test-license', timeoutMs:10000, env:{FAKE_SPINE_COUNTER:counter} });
    assert.equal(fs.readFileSync(counter, 'utf8'), '2');
    assert.equal(result.remappedPaths.length, 1);
    assert.equal(realpathSync(result.remappedPaths[0]), realpathSync(imagesDir));
    assert.deepEqual(fs.readFileSync(project), original);
    assert.ok(fs.existsSync(path.join(output, 'spine.json')));
    assert.ok(fs.existsSync(path.join(output, 'spine.atlas')));
    assert.ok(fs.existsSync(path.join(output, 'page.png')));
  } finally {
    rmSync(root, {recursive:true,force:true});
  }
});
