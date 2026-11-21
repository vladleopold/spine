import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { isAllowedSpineUploadPath } from '../lib/spine-upload-path.js';

test('accepts a project folder in the active collection', () => {
  assert.equal(isAllowedSpineUploadPath('library/hero-2026-11-21T10-00-00-000Z'), true);
});

test('accepts an explicitly sharded library collection', () => {
  assert.equal(isAllowedSpineUploadPath('library_02/hero-2026-11-21T10-00-00-000Z'), true);
});

test('rejects root-level projects and arbitrary root files', () => {
  assert.equal(isAllowedSpineUploadPath('hero-2026-11-21T10-00-00-000Z'), false);
  assert.equal(isAllowedSpineUploadPath('output-mobile-after.png'), false);
});

test('rejects traversal, absolute paths, and nested arbitrary destinations', () => {
  assert.equal(isAllowedSpineUploadPath('../hero'), false);
  assert.equal(isAllowedSpineUploadPath('library/../hero'), false);
  assert.equal(isAllowedSpineUploadPath('/library/hero'), false);
  assert.equal(isAllowedSpineUploadPath('library/hero/nested'), false);
  assert.equal(isAllowedSpineUploadPath('library\\hero'), false);
});

test('rejects similarly named but non-collection directories', () => {
  assert.equal(isAllowedSpineUploadPath('library_backup/hero'), false);
  assert.equal(isAllowedSpineUploadPath('library_x/hero'), false);
  assert.equal(isAllowedSpineUploadPath('library/index.json'), false);
});

test('rejects unsafe upload collection configuration', async () => {
  const { isAllowedSpineCollectionBasePath } = await import('../lib/spine-upload-path.js');
  assert.equal(isAllowedSpineCollectionBasePath('library'), true);
  assert.equal(isAllowedSpineCollectionBasePath('library_02'), true);
  assert.equal(isAllowedSpineCollectionBasePath('.'), false);
  assert.equal(isAllowedSpineCollectionBasePath('..'), false);
  assert.equal(isAllowedSpineCollectionBasePath('uploads'), false);
  assert.equal(isAllowedSpineCollectionBasePath('library/..'), false);
});

test('rejects upload filenames that can escape the project directory', async () => {
  const { isAllowedSpineUploadFileName } = await import('../lib/spine-upload-path.js');
  assert.equal(isAllowedSpineUploadFileName('hero.json'), true);
  assert.equal(isAllowedSpineUploadFileName('../README.md'), false);
  assert.equal(isAllowedSpineUploadFileName('nested/hero.json'), false);
  assert.equal(isAllowedSpineUploadFileName('nested\\hero.json'), false);
  assert.equal(isAllowedSpineUploadFileName('..'), false);
});

test('keeps all project artifact writes inside a validated project folder', async () => {
  const { isAllowedSpineProjectFilePath } = await import('../lib/spine-upload-path.js');
  assert.equal(isAllowedSpineProjectFilePath('library/hero/hero.json'), true);
  assert.equal(isAllowedSpineProjectFilePath('library_02/hero/source/hero.psd'), true);
  assert.equal(isAllowedSpineProjectFilePath('README.md'), false);
  assert.equal(isAllowedSpineProjectFilePath('library/../README.md'), false);
  assert.equal(isAllowedSpineProjectFilePath('library/hero/../../README.md'), false);
  assert.equal(isAllowedSpineProjectFilePath('library_backup/hero/file.json'), false);
});

test('API uses server-controlled roots and guards every client-directed artifact write', () => {
  const api = readFileSync(new URL('../api/github-upload.js', import.meta.url), 'utf8');
  assert.match(api, /basePath: cleanRepoPath\(process\.env\.GITHUB_BASE_PATH \|\| defaultBasePath\)/);
  assert.doesNotMatch(api, /body\?\.settings\?\.basePath/);
  assert.match(api, /function dataScienceBasePathFor\(\)/);
  assert.doesNotMatch(api, /body\?\.dataScience\?\.basePath/);
  assert.match(api, /isAllowedSpineProjectFilePath\(path, settings\.basePath\)/);
  assert.match(api, /isAllowedSpineProjectFilePath\(filePath, settings\.basePath\)/);
  assert.match(api, /isAllowedSpineProjectFilePath\(anchorPath, settings\.basePath\)/);
  assert.match(api, /isAllowedSpineUploadFileName\(item\?\.name\)/);
});
