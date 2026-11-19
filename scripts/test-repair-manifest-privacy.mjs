import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const workflow = readFileSync(new URL('../.github/workflows/repair-latest-twenty-previews.yml', import.meta.url), 'utf8');
const repair = readFileSync(new URL('./repair-latest-twenty-previews.mjs', import.meta.url), 'utf8');
const verify = readFileSync(new URL('./verify-latest-twenty-live.mjs', import.meta.url), 'utf8');
assert.ok(workflow.includes('name: repair-manifest'));
assert.ok(workflow.includes('REPAIR_MANIFEST_PATH: repair-manifest/repair-manifest.json'));
assert.ok(workflow.includes('ENTRY_INDEX: ${{ matrix.entry.index }}'));
assert.ok(!workflow.includes('REPAIR_IDS_JSON:'), 'raw source manifest must not be injected into public action environment logs');
assert.ok(repair.includes("writeFileSync(path.join(root,'repair-manifest.json')"));
assert.ok(repair.includes('process.env.REPAIR_MANIFEST_PATH'));
assert.ok(verify.includes('process.env.REPAIR_MANIFEST_PATH'));
assert.ok(!verify.includes('process.env.REPAIR_IDS_JSON'));
console.log('REPAIR_MANIFEST_LOG_PRIVACY_TESTS_PASSED');
