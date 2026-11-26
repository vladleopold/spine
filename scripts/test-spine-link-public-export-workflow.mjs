import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const workflow = fs.readFileSync(
  new URL('../.github/workflows/spine-link-project-export.yml', import.meta.url),
  'utf8',
);

test('Spine-Link project export is exposed as a reusable workflow', () => {
  assert.ok(workflow.includes('workflow_call:'));
  assert.ok(workflow.includes('upload_id:'));
  assert.ok(workflow.includes('type: string'));
});

test('all executor jobs use GitHub-hosted Ubuntu and never self-hosted runners', () => {
  assert.ok((workflow.match(/runs-on: ubuntu-24\.04/g) || []).length >= 3);
  assert.doesNotMatch(workflow, /self-hosted/i);
});

test('private source reads use the caller token while storage writes use a separate token', () => {
  assert.ok(workflow.includes("if: github.repository == 'vladleopold/3Spine-core'"));
  assert.ok(workflow.includes('SOURCE_REPO_TOKEN: ${{ github.token }}'));
  assert.ok(workflow.includes('STORAGE_GITHUB_TOKEN: ${{ secrets.STORAGE_GITHUB_TOKEN }}'));
  assert.ok(workflow.includes('GH_TOKEN="$STORAGE_GITHUB_TOKEN"'));
  assert.ok(!workflow.includes('GH_TOKEN="$SOURCE_REPO_TOKEN"'));
});

test('licensed export runs only for the private control-plane caller and not on pull requests', () => {
  assert.ok(workflow.includes("if: github.repository == 'vladleopold/3Spine-core' && github.event_name != 'pull_request'"));
  assert.ok(workflow.includes('SPINE_LINK_LICENSED_EXPORT_WAITING_FOR_SECRETS'));
});
