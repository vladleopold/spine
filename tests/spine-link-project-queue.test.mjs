import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { eligible, STORAGE_REPO } from '../scripts/spine-link-project-queue.mjs';
import { conversionExitCode } from '../scripts/spine-link-project-status.mjs';

const project = {
  sourceKind:'spine-project', id:'example-001',
  previewPath:'library_02/example-001', projectFile:'example.spine',
  conversionStatus:'pending'
};

test('licensed exporter targets only fixed storage repo', () => {
  assert.equal(STORAGE_REPO, 'vladleopold/spine');
});
test('pending projects are eligible; failed projects require an explicit retry', () => {
  assert.ok(eligible(project));
  assert.ok(!eligible({...project,conversionStatus:'needs-editor'}, '', {editorReady:false}));
  assert.ok(eligible({...project,conversionStatus:'needs-editor'}, '', {editorReady:true}));
  assert.ok(!eligible({...project,conversionStatus:'ready'}));
  assert.ok(!eligible({...project,conversionStatus:'failed'}));
  assert.ok(eligible({...project,conversionStatus:'failed'}, 'example-001'));
});

test('needs-editor projects wait for a licensed editor unless explicitly retried', () => {
  const blocked = {...project, conversionStatus:'needs-editor'};
  assert.equal(eligible(blocked, '', {editorReady:false}), false);
  assert.equal(eligible(blocked, '', {editorReady:true}), true);
  assert.equal(eligible(blocked, blocked.id, {editorReady:false}), true);
});
test('never process substituted repos, unrelated files, path traversal or invalid IDs', () => {
  assert.ok(!eligible({...project,previewPath:'library_02/other-id'}));
  assert.ok(!eligible({...project,projectFile:'../bad.spine'}));
  assert.ok(!eligible({...project,previewPath:'library_02/../example-001'}));
  assert.ok(!eligible({...project,sourceKind:'runtime-export'}));
  assert.ok(!eligible({...project,id:';echo hacked'}));
  assert.ok(!eligible(project,'another-id'));
});
test('output uses real licensed editor and nested export that the player discovers', () => {
  const exporter = fs.readFileSync('scripts/spine-link-project-cloud-export.mjs','utf8');
  const runner = fs.readFileSync('scripts/spine-editor-export.mjs','utf8');
  assert.match(exporter, /runLicensedSpineExport/);
  assert.match(exporter, /from '\.\/spine-editor-export\.mjs'/);
  assert.match(runner, /spawnSync\(cli,/);
  assert.match(runner, /'4\.3\.26'/);
  assert.match(runner, /'json\+pack'/);
  assert.match(exporter, /output = path\.resolve\(folder, 'export'\)/);
  assert.match(exporter, /conversionStatus:status/);
  assert.match(exporter, /webmStatus:'pending'/);
  assert.match(exporter, /status !== 'ready'/);
});

const publicWorkflow = fs.readFileSync(
  new URL('../.github/workflows/spine-link-project-export.yml', import.meta.url),
  'utf8',
);

test('public repository directly receives project export dispatch and executes on Ubuntu', () => {
  assert.ok(publicWorkflow.includes('repository_dispatch:'));
  assert.ok(publicWorkflow.includes('types: [spine-project-export]'));
  assert.ok(publicWorkflow.includes('runs-on: ubuntu-24.04'));
  assert.ok(publicWorkflow.includes('STORAGE_GITHUB_TOKEN: ${{ github.token }}'));
  assert.ok(!publicWorkflow.includes('workflow_call:'));
  assert.ok(!publicWorkflow.includes('3Spine-core'));
});

test('missing licensed Editor is a recorded needs-editor state, not a failed runner job', () => {
  assert.equal(conversionExitCode('needs-editor'), 0);
  assert.equal(conversionExitCode('ready'), 0);
  assert.equal(conversionExitCode('failed'), 1);
});
