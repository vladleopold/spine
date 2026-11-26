import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';

const workflow = fs.readFileSync(
  new URL('../.github/workflows/repair-latest-twenty-previews.yml', import.meta.url),
  'utf8',
);

test('archive recovery does not dispatch the next batch until production verification succeeds', () => {
  const job = workflow.match(/  dispatch-next-batch:\n([\s\S]*?)(?=\n  [a-z0-9-]+:\n|$)/)?.[1] || '';
  assert.match(job, /needs:\s*\[inventory,\s*render,\s*publish,\s*verify-production\]/);
  assert.match(job, /needs\.verify-production\.result\s*==\s*'success'/);
  assert.match(job, /needs\.render\.result\s*==\s*'success'/);
  assert.match(job, /needs\.publish\.result\s*==\s*'success'/);
});
