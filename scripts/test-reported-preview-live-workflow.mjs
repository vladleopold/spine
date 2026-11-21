import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const workflowPath = path.join(root, '.github/workflows/verify-reported-preview-live.yml');
const verifierPath = path.join(root, 'scripts/verify-reported-preview-live.mjs');
const workflow = fs.readFileSync(workflowPath, 'utf8');
const verifier = fs.readFileSync(verifierPath, 'utf8');

const lines = workflow.split(/\r?\n/);
const sparseLine = lines.findIndex((line) => line.trim() === 'sparse-checkout: |');
assert.notEqual(sparseLine, -1, 'production audit checkout must declare sparse-checkout');
const sparseIndent = lines[sparseLine].match(/^\s*/)[0].length;
const sparsePaths = new Set();
for (let i = sparseLine + 1; i < lines.length; i += 1) {
  const line = lines[i];
  if (!line.trim()) continue;
  const indent = line.match(/^\s*/)[0].length;
  if (indent <= sparseIndent) break;
  const value = line.trim();
  if (!value.startsWith('/')) break;
  sparsePaths.add(value.slice(1));
}

function isCheckedOut(filePath) {
  return [...sparsePaths].some((entry) => filePath === entry || filePath.startsWith(entry.endsWith('/') ? entry : entry + '/'));
}

const importPattern = /^\s*import\s+(?:[^;\n]*?\s+from\s+)?['"]([^'"]+)['"]\s*;?\s*$/gm;
const imports = [...verifier.matchAll(importPattern)].map((match) => match[1]);
assert.ok(imports.length > 0, 'production verifier must retain explicit static imports');

for (const specifier of imports) {
  if (!specifier.startsWith('.')) continue;
  const resolved = path.posix.normalize(path.posix.join('scripts', specifier));
  assert.ok(fs.existsSync(path.join(root, resolved)), 'verifier dependency must exist: ' + resolved);
  assert.ok(isCheckedOut(resolved), 'sparse checkout must include verifier dependency: ' + resolved);
}

assert.ok(isCheckedOut('.github/workflows/verify-reported-preview-live.yml'),
  'sparse checkout must include the audited workflow source');
assert.ok(isCheckedOut('scripts/test-reported-preview-live-workflow.mjs'),
  'sparse checkout must include this regression test');
assert.ok(isCheckedOut('library_02/index.json'),
  'production audit requires the reported-work index');

const testStep = workflow.indexOf('node scripts/test-reported-preview-live-workflow.mjs');
const verifyStep = workflow.indexOf('node scripts/verify-reported-preview-live.mjs');
assert.ok(testStep >= 0 && verifyStep > testStep,
  'sparse-checkout regression must run before the live production audit');
assert.match(workflow, /schedule:\s*\n\s+- cron:/,
  'reported-preview production audit must retain its hourly schedule');
assert.match(workflow, /group:\s*reported-preview-production-audit/,
  'hourly and workflow_run audits must share one concurrency group');

console.log('PASS reported-preview production workflow sparse-checkout contract');
