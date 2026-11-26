import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const workflow = fs.readFileSync(
  new URL('../.github/workflows/spine-link-project-export.yml', import.meta.url),
  'utf8',
);

test('Spine-Link project export is exposed as a reusable workflow', () => {
  assert.match(workflow, /workflow_call:/);
  assert.match(workflow, /upload_id:/);
  assert.match(workflow, /type: string/);
});

test('all executor jobs use GitHub-hosted Ubuntu and never self-hosted runners', () => {
  assert.ok((workflow.match(/runs-on: ubuntu-24\.04/g) || []).length >= 3);
  assert.doesNotMatch(workflow, /self-hosted/i);
});

test('private source reads use the caller token while storage writes use a separate token', () => {
  assert.match(workflow, /github\.repository == 'vladleopold\/3Spine-core' && github\.token/);
  assert.match(workflow, /STORAGE_GITHUB_TOKEN: \$\{\{ secrets\.STORAGE_GITHUB_TOKEN \}\}/);
  assert.match(workflow, /GH_TOKEN="\$STORAGE_GITHUB_TOKEN"/);
  assert.doesNotMatch(workflow, /GH_TOKEN="\$SOURCE_REPO_TOKEN"/);
});

test('licensed export runs only for the private control-plane caller and not on pull requests', () => {
  assert.match(workflow, /if: github\.repository == 'vladleopold\/3Spine-core' && github\.event_name != 'pull_request'/);
  assert.match(workflow, /SPINE_LINK_LICENSED_EXPORT_WAITING_FOR_SECRETS/);
});
