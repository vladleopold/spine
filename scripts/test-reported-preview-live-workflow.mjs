import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const auditWorkflowPath = path.join(root, '.github/workflows/verify-reported-preview-live.yml');
const repairWorkflowPath = path.join(root, '.github/workflows/repair-reported-previews.yml');
const auditWorkflow = fs.readFileSync(auditWorkflowPath, 'utf8');
const repairWorkflow = fs.readFileSync(repairWorkflowPath, 'utf8');

function sparseCheckoutPaths(source, label) {
  const lines = source.split(/\r?\n/);
  const start = lines.findIndex((line) => line.trim() === 'sparse-checkout: |');
  assert.notEqual(start, -1, label + ' must declare sparse-checkout');
  const parentIndent = lines[start].match(/^\s*/)[0].length;
  const paths = new Set();
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim()) continue;
    const indent = line.match(/^\s*/)[0].length;
    if (indent <= parentIndent) break;
    const value = line.trim();
    if (!value.startsWith('/')) break;
    paths.add(value.slice(1));
  }
  return paths;
}

function includesPath(paths, filePath) {
  return [...paths].some((entry) =>
    filePath === entry || filePath.startsWith(entry.endsWith('/') ? entry : entry + '/'));
}

function importSpecifiers(source) {
  const pattern = /^\s*import\s+(?:[^;\n]*?\s+from\s+)?['"]([^'"]+)['"]\s*;?\s*$/gm;
  return [...source.matchAll(pattern)].map((match) => match[1]);
}

function assertImportClosure(entrypoints, sparsePaths, label) {
  const visited = new Set();
  function visit(relativePath) {
    const normalized = path.posix.normalize(relativePath);
    if (visited.has(normalized)) return;
    visited.add(normalized);
    const absolutePath = path.join(root, normalized);
    assert.ok(fs.existsSync(absolutePath), label + ' is missing ' + normalized);
    assert.ok(includesPath(sparsePaths, normalized),
      label + ' sparse checkout omits ' + normalized);
    const source = fs.readFileSync(absolutePath, 'utf8');
    for (const specifier of importSpecifiers(source)) {
      if (!specifier.startsWith('.')) continue;
      const dependency = path.posix.normalize(path.posix.join(path.posix.dirname(normalized), specifier));
      visit(dependency);
    }
  }
  for (const entrypoint of entrypoints) visit(entrypoint);
}

const auditSparse = sparseCheckoutPaths(auditWorkflow, 'production audit workflow');
const repairVerifyStart = repairWorkflow.indexOf('  verify-production:');
assert.ok(repairVerifyStart >= 0, 'repair workflow must retain one post-publish production verification job');
const repairVerifyJob = repairWorkflow.slice(repairVerifyStart);
const repairVerifySparse = sparseCheckoutPaths(repairVerifyJob, 'post-publish verification job');

const entrypoints = [
  'scripts/verify-reported-preview-live.mjs',
  'scripts/test-reported-preview-live.mjs',
  'scripts/test-reported-preview-live-workflow.mjs',
  'scripts/verify-preview-motion.mjs',
  'scripts/verify-poster-first-frame.mjs',
];
assertImportClosure(entrypoints, auditSparse, 'hourly production audit');
assertImportClosure(entrypoints, repairVerifySparse, 'post-publish production audit');

for (const required of [
  '.github/workflows/repair-reported-previews.yml',
  '.github/workflows/verify-reported-preview-live.yml',
  'scripts/test-reported-preview-live-workflow.mjs',
  'library_02/index.json',
]) {
  assert.ok(includesPath(auditSparse, required), 'hourly audit sparse checkout must include ' + required);
  assert.ok(includesPath(repairVerifySparse, required), 'post-publish sparse checkout must include ' + required);
}

assert.match(auditWorkflow, /schedule:\s*\n\s+- cron:/,
  'production preview audit must remain hourly');
assert.match(auditWorkflow, /group:\s*reported-preview-production-audit/,
  'hourly audit must not overlap itself');
assert.doesNotMatch(auditWorkflow, /^\s*workflow_run:/m,
  'do not duplicate the post-publish audit already owned by the repair workflow');
assert.match(auditWorkflow, /apt-get install[^\n]*ffmpeg|command -v ffmpeg/,
  'hourly audit must install a real media decoder');
const hourlyTest = auditWorkflow.indexOf('node scripts/test-reported-preview-live.mjs');
const hourlyVerify = auditWorkflow.indexOf('node scripts/verify-reported-preview-live.mjs');
assert.ok(hourlyTest >= 0 && hourlyVerify > hourlyTest,
  'media acceptance regression must run before the hourly live audit');

assert.match(repairWorkflow, /pull_request:/,
  'the repair workflow must validate pull-request changes');
assert.match(repairWorkflow, /^permissions:\s*\n\s+contents:\s+read/m,
  'workflow-wide permissions must be read-only');
const publishStart = repairWorkflow.indexOf('  publish:');
const publishJob = repairWorkflow.slice(publishStart);
assert.match(publishJob, /^    permissions:\s*\n\s+contents:\s+write/m,
  'only the publisher may write source changes');
assert.ok(repairWorkflow.includes('node scripts/test-reported-preview-live.mjs'),
  'repair inventory must run the media acceptance regression');
assert.match(repairWorkflow, /apt-get install[^\n]*ffmpeg|command -v ffmpeg/,
  'post-publish audit must install a real media decoder');
const repairTest = repairVerifyJob.indexOf('node scripts/test-reported-preview-live.mjs');
const repairVerify = repairVerifyJob.indexOf('node scripts/verify-reported-preview-live.mjs');
assert.ok(repairTest >= 0 && repairVerify > repairTest,
  'media acceptance regression must run before post-publish live verification');

console.log('PASS reported-preview audit dependency closure, no duplicate trigger, HTTP classification, motion and poster gates');
