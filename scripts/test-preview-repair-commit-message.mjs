#!/usr/bin/env node
// Pure regression: commit descriptions must reflect verified media outcomes.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { previewRepairCommitMessage } from './lib/preview-repair-commit-message.mjs';

assert.equal(
  previewRepairCommitMessage({ ready: 0, blocked: 20, failed: 0 }),
  'chore: record latest-20 blocked preview results (0 ready, 20 blocked, 0 failed)',
);
assert.equal(
  previewRepairCommitMessage({ ready: 3, blocked: 17, failed: 0 }),
  'fix: publish latest-20 verified preview results (3 ready, 17 blocked, 0 failed)',
);
assert.equal(
  previewRepairCommitMessage({ ready: 0, blocked: 0, failed: 4 }),
  'chore: record latest-20 failed preview results (0 ready, 0 blocked, 4 failed)',
);
assert.throws(
  () => previewRepairCommitMessage({ ready: 0, blocked: -1, failed: 0 }),
  /INVALID_PREVIEW_REPAIR_SUMMARY_BLOCKED/,
);
assert.throws(
  () => previewRepairCommitMessage({ ready: 0, blocked: 0, failed: 0 }),
  /EMPTY_PREVIEW_REPAIR_SUMMARY/,
);

const workflow = fs.readFileSync(
  new URL('../.github/workflows/repair-latest-twenty-previews.yml', import.meta.url),
  'utf8',
);
assert.match(workflow, /previewRepairCommitMessage\(summary\)/);
assert.match(workflow, /git commit -m "\$commit_message"/);
assert.doesNotMatch(
  workflow,
  /git commit -m 'fix: restore validated previews for latest 20 Spine uploads'/,
  'a blocked-only repair must never create a commit claiming previews were restored',
);
console.log('PASS latest20 commit message reports verified ready/blocked/failed counts');
