import assert from 'node:assert/strict';
import fs from 'node:fs';

const workflow = fs.readFileSync(
  new URL('../.github/workflows/canvas-recovery-e2e.yml', import.meta.url),
  'utf8',
);

assert.match(workflow, /for suffix in '' '-medium' '-low'/,
  'the exact-animation gate must validate every published quality tier');
assert.match(workflow, /node scripts\\/verify-preview-motion\\.mjs "\\$video"/,
  'every quality tier must contain at least eight distinct, nonzero moving frames');
assert.match(workflow, /node scripts\\/verify-poster-first-frame\\.mjs "\\$video" "\\$poster"/,
  'every WebP poster must match the first frame of its exact paired WebM');
assert.match(workflow, /SOURCE_PRESERVATION_PASS/);
assert.match(workflow, /sha256sum -c/);
assert.match(workflow, /cmp -s/);
assert.match(workflow, /source-files\\.before/);
assert.match(workflow, /source-hashes\\.before/);
assert.doesNotMatch(workflow, /actions\\/upload-artifact@/,
  'private render outputs must stay in the ephemeral runner');

console.log('PASS canvas recovery: all quality tiers have moving-frame and poster gates; source bytes stay unchanged; private outputs remain temporary');
