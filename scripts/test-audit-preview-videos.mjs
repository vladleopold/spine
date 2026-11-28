import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import fs from 'node:fs';

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

test('full-library preview audit runs daily and automatically requests missing or invalid exports', () => {
  const workflow = fs.readFileSync(path.resolve('.github/workflows/audit-preview-videos.yml'), 'utf8');
  assert.match(workflow, /schedule:\\s*\\n\\s+- cron: '17 3 \\* \\* \\*'/);
  assert.match(workflow, /report\\.missing[\\s\\S]*report\\.invalid[\\s\\S]*report\\.errors/);
  assert.match(workflow, /createWorkflowDispatch/);
});
