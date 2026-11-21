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
  // This is deliberately a small source scanner, not a single-line import regex:
  // multiline named imports were the exact dependency shape omitted by the old
  // checker. Strip comments before scanning so examples in comments are ignored.
  const clean = source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '');
  const found = [];

  const staticImports = /^\s*import\s+(?!\()([\s\S]*?);/gm;
  for (const match of clean.matchAll(staticImports)) {
    const clause = match[1];
    const from = clause.match(/\bfrom\s*(['"])([^'"]+)\1/);
    const sideEffect = clause.match(/^\s*(['"])([^'"]+)\1\s*$/);
    const specifier = from?.[2] || sideEffect?.[2];
    if (specifier) found.push(specifier);
  }

  const reExports = /^\s*export\s+(?:\*|\{[\s\S]*?\})\s+from\s*(['"])([^'"]+)\1\s*;?/gm;
  for (const match of clean.matchAll(reExports)) found.push(match[2]);

  const dynamicImports = /\bimport\s*\(\s*(['"])([^'"]+)\1\s*\)/g;
  for (const match of clean.matchAll(dynamicImports)) found.push(match[2]);

  const commonJsRequires = /\brequire\s*\(\s*(['"])([^'"]+)\1\s*\)/g;
  for (const match of clean.matchAll(commonJsRequires)) found.push(match[2]);

  return [...new Set(found)];
}

function resolveLocalDependency(importerPath, specifier) {
  const base = path.posix.normalize(path.posix.join(path.posix.dirname(importerPath), specifier));
  const candidates = [
    base,
    ...['.mjs', '.js', '.cjs', '.json'].map((extension) => base + extension),
    ...['index.mjs', 'index.js', 'index.cjs', 'index.json'].map((name) => path.posix.join(base, name)),
  ];
  return candidates.find((candidate) => fs.existsSync(path.join(root, candidate))) || base;
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
      visit(resolveLocalDependency(normalized, specifier));
    }
  }
  for (const entrypoint of entrypoints) visit(entrypoint);
}

assert.deepEqual(importSpecifiers(`
import {
  directDependency,
  anotherDependency,
} from './multiline-dependency.mjs';
import './side-effect-dependency.mjs';
export {
  reExported,
} from './re-export-dependency.mjs';
await import('./dynamic-dependency.mjs');
const commonJs = require('./commonjs-dependency.cjs');
// import { ignored } from './comment-only-dependency.mjs';
`), [
  './multiline-dependency.mjs',
  './side-effect-dependency.mjs',
  './re-export-dependency.mjs',
  './dynamic-dependency.mjs',
  './commonjs-dependency.cjs',
], 'dependency scanner must include multiline, side-effect, re-export, dynamic and CommonJS imports');

const inventoryStart = repairWorkflow.indexOf('  inventory:');
const appBuildStart = repairWorkflow.indexOf('  app-build:', inventoryStart);
assert.ok(inventoryStart >= 0 && appBuildStart > inventoryStart,
  'repair workflow must retain an isolated inventory job');
const inventorySparse = sparseCheckoutPaths(
  repairWorkflow.slice(inventoryStart, appBuildStart),
  'reported preview repair inventory',
);
const auditSparse = sparseCheckoutPaths(auditWorkflow, 'production audit workflow');
const repairVerifyStart = repairWorkflow.indexOf('  verify-production:');
assert.ok(repairVerifyStart >= 0, 'repair workflow must retain one post-publish production verification job');
const repairVerifyJob = repairWorkflow.slice(repairVerifyStart);
const repairVerifySparse = sparseCheckoutPaths(repairVerifyJob, 'post-publish verification job');

const entrypoints = [
  'scripts/verify-reported-preview-live.mjs',
  'scripts/test-reported-preview-live.mjs',
  'scripts/verify-preview-motion.mjs',
  'scripts/verify-poster-first-frame.mjs',
];
assertImportClosure(['scripts/repair-reported-previews.mjs'], inventorySparse,
  'reported preview repair inventory');
assertImportClosure(entrypoints, auditSparse, 'hourly production audit');
assertImportClosure(entrypoints, repairVerifySparse, 'post-publish production audit');

// Prove the historical failure is caught: the verifier's multiline import of
// this module must make a sparse checkout without it fail before execution.
const historicalMissingDependency = 'scripts/lib/reported-preview-live-status.mjs';
const auditWithoutHistoricalDependency = new Set(
  [...auditSparse].filter((entry) => entry !== historicalMissingDependency),
);
assert.throws(
  () => assertImportClosure(['scripts/verify-reported-preview-live.mjs'], auditWithoutHistoricalDependency,
    'historical missing-dependency fixture'),
  (error) => error.message.includes('sparse checkout omits scripts/lib/reported-preview-live-status.mjs'),
  'a missing multiline direct dependency must be detected',
);

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

assert.ok(includesPath(inventorySparse, 'scripts/lib/reported-preview-repair-status.mjs'),
  'repair inventory must include the stored-status acceptance helper');
assert.ok(includesPath(inventorySparse, 'scripts/lib/atlas-source-integrity.mjs'),
  'repair inventory must include full atlas-page reconciliation');
const renderStart = repairWorkflow.indexOf('  render:');
const publishStart = repairWorkflow.indexOf('  publish:', renderStart);
assert.ok(renderStart >= 0 && publishStart > renderStart);
const renderJob = repairWorkflow.slice(renderStart, publishStart);
assert.match(renderJob,
  /if: github\.ref == 'refs\/heads\/main' \|\| github\.event_name == 'pull_request'/,
  'source rendering must run as a pull-request quality gate');
assert.match(renderJob,
  /if: matrix\.entry\.needsRender && github\.ref == 'refs\/heads\/main'/,
  'private media artifacts must be uploaded only by the main-branch publisher');
const existingValidation = renderJob.indexOf('repair-reported-previews.mjs validate-existing');
const nativeRender = renderJob.indexOf('node scripts/spine-export-webm.mjs');
assert.ok(existingValidation >= 0 && nativeRender > existingValidation,
  'failed stored status must be revalidated from the exact source before a same-animation rerender');
const publishJob = repairWorkflow.slice(publishStart);
assert.match(publishJob, /selected\.length!==19/,
  'the repair publisher must require the 18 reported projects plus the exact priority work');
assert.match(publishJob, /pattern: reported19-\*/);
assert.match(repairWorkflow, /^permissions:\s*\n\s+contents:\s+read/m,
  'workflow-wide permissions must be read-only');
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


assert.match(renderJob, /ENTRY_BASE_PATH: \\$\\{\\{ matrix\\.entry\\.basePath \\}\\}/,
  'each render job must fingerprint the exact collection index');
assert.match(renderJob, /id: source_fingerprint/);
assert.match(renderJob, /source-files\\.before/);
assert.match(renderJob, /source-hashes\\.before/);
assert.match(renderJob, /index-hash\\.before/);
assert.match(renderJob, /sha256sum -c/);
assert.match(renderJob, /cmp -s/);
assert.match(renderJob, /SOURCE_PRESERVATION_PASS/);
assert.match(renderJob, /if: always\\(\\) && steps\\.source_fingerprint\\.outputs\\.captured == 'true'/);
const fingerprintPosition = renderJob.indexOf('name: Fingerprint original source and index before rendering');
const nativeRenderPosition = renderJob.indexOf('name: Render and validate actual Spine video + still posters');
const preservationPosition = renderJob.indexOf('name: Verify original source and index remain byte-identical');
assert.ok(fingerprintPosition >= 0 && nativeRenderPosition > fingerprintPosition &&
  preservationPosition > nativeRenderPosition,
  'the source and index must be fingerprinted before, then verified after every exact-source render');

console.log('PASS reported-preview audit dependency closure, including multiline imports and the historical omission fixture');
