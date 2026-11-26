import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const workflow = fs.readFileSync(
  new URL('../.github/workflows/repair-latest-twenty-previews.yml', import.meta.url),
  'utf8',
);

test('independent archive batches continue after partial production audit failures', () => {
  const job = workflow.match(/  dispatch-next-batch:\n([\s\S]*?)(?=\n  [a-z0-9-]+:\n|$)/)?.[1] || '';
  const condition = job.match(/^\s+if:\s*(.+)$/m)?.[1] || '';
  assert.match(job, /needs:\s*\[inventory,\s*render,\s*publish,\s*verify-production\]/);
  assert.match(condition, /always\(\)/);
  assert.match(condition, /needs\.render\.result\s*==\s*'success'/);
  assert.match(condition, /needs\.publish\.result\s*==\s*'success'/);
  assert.doesNotMatch(condition, /needs\.verify-production\.result/);
});
