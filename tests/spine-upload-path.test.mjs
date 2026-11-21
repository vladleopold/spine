import test from 'node:test';
import assert from 'node:assert/strict';
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
