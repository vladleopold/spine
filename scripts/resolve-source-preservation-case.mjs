import { appendFileSync, readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { resolveSourcePreservationCase } from './lib/source-preservation-case.mjs';
import { collectSensitiveExportValues, escapeWorkflowCommandValue } from './lib/export-log-redaction.mjs';

const entries = JSON.parse(readFileSync('library_02/index.json', 'utf8'));
const resolved = resolveSourcePreservationCase(entries, process.env.CASE_INDEX);
if (resolved.status !== 'ready') {
  console.error('SOURCE_CASE_BLOCKED:' + resolved.code);
  process.exit(1);
}

const privateValues = new Set([
  resolved.sourceDir,
  resolved.animation,
  ...collectSensitiveExportValues(resolved.entry),
]);
for (const value of privateValues) {
  const escaped = escapeWorkflowCommandValue(value);
  if (escaped) process.stdout.write('::add-mask::' + escaped + '\n');
}

const envValues = {
  ENTRY_ID: resolved.entry.id,
  ANIMATION: resolved.animation,
  SOURCE_DIR: resolved.sourceDir,
};
for (const value of Object.values(envValues)) {
  if (typeof value !== 'string' || /[\r\n]/.test(value)) {
    console.error('SOURCE_CASE_BLOCKED:invalid-environment-value');
    process.exit(1);
  }
}

execFileSync('git', ['sparse-checkout', 'add', '--skip-checks', '/' + resolved.sourceDir + '/'], {
  stdio: 'inherit',
});
appendFileSync(process.env.GITHUB_ENV, Object.entries(envValues)
  .map(([key, value]) => key + '=' + value)
  .join('\n') + '\n');
process.stdout.write('SOURCE_CASE_RESOLVED\n');
