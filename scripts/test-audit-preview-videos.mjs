import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';

test('preview FPS audit script parses as valid JavaScript before it can run in CI', () => {
  const target = path.resolve('scripts/audit-preview-videos.mjs');
  const result = spawnSync(process.execPath, ['--check', target], {
    encoding: 'utf8',
  });
  assert.equal(
    result.status,
    0,
    [result.stdout, result.stderr].filter(Boolean).join('\n') ||
      'audit-preview-videos.mjs must pass node --check',
  );
});
