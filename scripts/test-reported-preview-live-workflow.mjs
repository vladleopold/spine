import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const auditWorkflowPath = path.join(root, '.github/workflows/verify-reported-preview-live.yml');
const repairWorkflowPath = path.join(root, '.github/workflows/repair-reported-previews.yml');
const verifierPath = path.join(root, 'scripts/verify-reported-preview-live.mjs');
const auditWorkflow = fs.readFileSync(auditWorkflowPath, 'utf8');
const repairWorkflow = fs.readFileSync(repairWorkflowPath, 'utf8');
const verifier = fs.readFileSync(verifierPath, 'utf8');

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

const auditSparse = sparseCheckoutPaths(auditWorkflow, 'production audit workflow');
const repairSparse = sparseCheckoutPaths(repairWorkflow, 'repair inventory workflow');

const importPattern = /^\s*import\s+(?:[^;\n]*?\s+from\s+)?['"]([^'"]+)['"]\s*;?\s*$/gm;
const imports = [...verifier.matchAll(importPattern)].map((match) => match[1]);
assert.ok(imports.length > 0, 'production verifier must retain explicit static imports');

for (const specifier of imports) {
  if (!specifier.startsWith('.')) continue;
  const resolved = path.posix.normalize(path.posix.join('scripts', specifier));
  assert.ok(fs.existsSync(path.join(root, resolved)), 'verifier dependency must exist: ' + resolved);
  assert.ok(includesPath(auditSparse, resolved),
    'production audit sparse checkout must include verifier dependency: ' + resolved);
}

assert.ok(includesPath(auditSparse, 'scripts/test-reported-preview-live-workflow.mjs'),
  'production audit sparse checkout must include this regression test');
assert.ok(includesPath(auditSparse, 'library_02/index.json'),
  'production audit requires the reported-work index');
assert.ok(includesPath(repairSparse, '.github/workflows/verify-reported-preview-live.yml'),
  'repair inventory sparse checkout must include the audited workflow source');
assert.ok(includesPath(repairSparse, 'scripts/test-reported-preview-live-workflow.mjs'),
  'repair inventory sparse checkout must include this regression test');

const testStep = auditWorkflow.indexOf('node scripts/test-reported-preview-live-workflow.mjs');
const verifyStep = auditWorkflow.indexOf('node scripts/verify-reported-preview-live.mjs');
assert.ok(testStep >= 0 && verifyStep > testStep,
  'sparse-checkout regression must run before the live production audit');
assert.match(auditWorkflow, /schedule:\s*\n\s+- cron:/,
  'reported-preview production audit must retain its hourly schedule');
assert.match(auditWorkflow, /group:\s*reported-preview-production-audit/,
  'hourly and workflow_run audits must share one concurrency group');

console.log('PASS reported-preview production workflow sparse-checkout contract');
