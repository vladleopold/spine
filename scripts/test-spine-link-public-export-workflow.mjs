import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const workflow = fs.readFileSync(
  new URL('../.github/workflows/spine-link-project-export.yml', import.meta.url),
  'utf8',
);

test('public storage repository directly receives Spine project export dispatches', () => {
  assert.ok(workflow.includes('repository_dispatch:'));
  assert.ok(workflow.includes('types: [spine-project-export]'));
  assert.ok(workflow.includes('runs-on: ubuntu-24.04'));
  assert.ok(!workflow.includes('workflow_call:'));
  assert.ok(!workflow.includes('3Spine-core'));
});

test('public exporter uses its own least-privilege GitHub token for storage writes', () => {
  assert.ok(workflow.includes('contents: write'));
  assert.ok(workflow.includes('STORAGE_GITHUB_TOKEN: ${{ github.token }}'));
});

test('pending project queue is rescanned at least every fifteen minutes', () => {
  assert.ok(workflow.includes("cron: '*/15 * * * *'"));
});

test('licensed Editor configuration is checked before any project is marked ready', () => {
  assert.ok(workflow.includes('SPINE_LICENSE'));
  assert.ok(workflow.includes('SPINE_LINUX_URL'));
  assert.ok(workflow.includes("cron: '17 * * * *'"));
  assert.ok(workflow.includes("github.event_name == 'schedule'"));
  assert.ok(workflow.includes('conversion will be recorded as needs-editor'));
  assert.ok(workflow.includes('node scripts/spine-link-project-cloud-export.mjs'));
});
