import assert from 'node:assert/strict';
import fs from 'node:fs';
import { collectPreviewManifestSecrets, previewManifestMaskCommands } from './lib/preview-manifest-redaction.mjs';
import { escapeWorkflowCommandValue } from './lib/export-log-redaction.mjs';
import { choosePreviewAnimation } from './preview-animation-choice.mjs';

const sample = [{
  repairSlot: 0,
  id: 'private-upload-001',
  basePath: 'library_02',
  previewPath: 'library_02/private-upload-001',
  animation: 'Private Walk',
  sourceFingerprint: 'f'.repeat(64),
}];
const raw = JSON.stringify(sample);
for (const selected of ['Walk', 'Missing', ' Walk ', ' ']) {
  assert.equal(choosePreviewAnimation(['Walk'], selected), selected,
    'explicit animation names, including unavailable and whitespace-padded names, must remain byte-for-byte unchanged');
}
assert.equal(choosePreviewAnimation(['Walk']), '',
  'no selection must not infer the first animation');
const environment = {
  ENTRY_ID: 'private-render-002',
  ENTRY_PATH: 'library_03/private-render-002',
  ENTRY_ANIMATION: 'Private Run',
};
const secrets = collectPreviewManifestSecrets(sample, raw, environment);
for (const value of [
  raw,
  'private-upload-001',
  'library_02/private-upload-001',
  'Private Walk',
  'f'.repeat(64),
  'private-render-002',
  'library_03/private-render-002',
  'Private Run',
]) assert.ok(secrets.includes(value), 'missing sensitive manifest value');

const commands = previewManifestMaskCommands(sample, raw, environment);
for (const value of secrets) {
  assert.ok(commands.includes('::add-mask::' + escapeWorkflowCommandValue(value) + '\n'),
    'missing add-mask command for a sensitive value');
}

const reportScript = fs.readFileSync(new URL('./verify-reported-preview-live.mjs', import.meta.url), 'utf8');
const reportLogs = reportScript.split('\n').filter(line => /console\.(?:log|error)/.test(line));
assert.ok(reportLogs.length > 0);
assert.ok(reportLogs.every(line => !/\bid\b/.test(line)),
  'reported-preview audit logs must use numeric slots, never upload IDs');

const reported = fs.readFileSync(new URL('../.github/workflows/repair-reported-previews.yml', import.meta.url), 'utf8');
const latestTen = fs.readFileSync(new URL('../.github/workflows/repair-last-ten-previews.yml', import.meta.url), 'utf8');
const latestTwenty = fs.readFileSync(new URL('../.github/workflows/repair-latest-twenty-previews.yml', import.meta.url), 'utf8');
const reportedRepair = fs.readFileSync(new URL('./repair-reported-previews.mjs', import.meta.url), 'utf8');
const latestTwentyRepair = fs.readFileSync(new URL('./repair-latest-twenty-previews.mjs', import.meta.url), 'utf8');
const latestTenRepair = fs.readFileSync(new URL('./repair-last-ten-previews.mjs', import.meta.url), 'utf8');

assert.match(reported, /pull_request:/);
assert.match(reported, /  inventory:\n    permissions:\n      contents: read/);

for (const workflow of [reported, latestTen, latestTwenty]) {
  assert.ok(workflow.includes('node scripts/mask-preview-manifest.mjs'),
    'every manifest-consuming workflow must mask before use');
  assert.doesNotMatch(workflow, /^        env:\n          REPAIR_IDS_JSON:/m,
    'sensitive manifests must not be step-level env values printed before masking');
  assert.ok(workflow.includes('    env:\n      REPAIR_IDS_JSON:'),
    'manifest must be job-scoped so the first step can mask it');
}

const reportedRender = reported.slice(reported.indexOf('  render:'), reported.indexOf('  publish:'));
assert.match(reportedRender, /name: validate-reported-preview-\$\{\{ matrix\.entry\.repairSlot \}\}/);
assert.match(reportedRender, /name: reported19-\$\{\{ matrix\.entry\.repairSlot \}\}/);
assert.match(reported, /pattern: reported19-\*/);
assert.match(reported, /path: downloaded-reported19/);
assert.doesNotMatch(reportedRender, /name:.*matrix\.entry\.id/);
assert.doesNotMatch(reportedRender, /\/\$\{\{ matrix\.entry\.previewPath \}\}\//);

const latestTwentyRender = latestTwenty.slice(latestTwenty.indexOf('  render:'), latestTwenty.indexOf('  publish:'));
assert.match(latestTwentyRender, /name: validate-latest20-\$\{\{ matrix\.entry\.repairSlot \}\}/);
assert.match(latestTwentyRender, /name: latest20-\$\{\{ matrix\.entry\.repairSlot \}\}/);
assert.doesNotMatch(latestTwentyRender, /name:.*matrix\.entry\.id/);
assert.doesNotMatch(latestTwentyRender, /\/\$\{\{ matrix\.entry\.previewPath \}\}\//);

assert.match(latestTen, /name: validate-recovery-\$\{\{ matrix\.entry\.repairSlot \}\}/);
assert.match(latestTen, /name: latest10-\$\{\{ matrix\.entry\.repairSlot \}\}/);
assert.match(reportedRepair, /downloaded-reported19/);
assert.match(reportedRepair, /reported19-"\+item\.repairSlot/);
assert.match(reportedRepair, /const defaultAnimation=choosePreviewAnimation\(\[\],entry\.defaultAnimation\)/);
assert.match(reportedRepair, /!animation\?"MISSING_DEFAULT_ANIMATION"/);
assert.match(reportedRepair, /const animation=choosePreviewAnimation\(\[\],e\.defaultAnimation\)/);
assert.match(reportedRepair, /const selectedAnimation=choosePreviewAnimation\(\[\],item\.animation\)/);
assert.doesNotMatch(reportedRepair, /e\.id==="[^"]+"\?"[^"]+"/,
  'reported repair must not inject per-work alternate animation names');
assert.doesNotMatch(reportedRepair, /\.trim\(\)/,
  'reported repair must not trim selected animation names');
assert.doesNotMatch(reportedRepair, /record\.defaultAnimation\s*=\s*animation/,
  'preview publication must not rewrite defaultAnimation');
assert.doesNotMatch(reportedRepair, /record\.animations\s*=\s*meta\.animations/,
  'preview publication must not rewrite source animation names');
assert.doesNotMatch(latestTwentyRepair, /record\.animations\s*=\s*meta\.animations/,
  'latest-twenty publication must not rewrite source animation names');
assert.match(reportedRepair, /meta\?\.existingVerified===true/);
assert.match(reportedRepair, /fingerprintPreviewMedia/);
assert.match(reportedRepair, /meta\.mediaFingerprint/);
assert.match(reportedRepair, /verify-preview-motion\.mjs/);
assert.match(reportedRepair, /verify-poster-first-frame\.mjs/);
assert.doesNotMatch(reportedRepair, /previous media retained/,
  'index-ready media must be decoded before it can remain ready');
assert.match(reportedRepair, /blocked-missing-animation/);
assert.match(reportedRepair, /BLOCKED_SOURCE_BUNDLE=/);
assert.match(reportedRepair, /BLOCKED_MISSING_ANIMATION=/);
assert.match(reportedRepair, /meta\?\.animationMatches===true/);
assert.match(latestTwentyRepair, /latest20-"\+item\.repairSlot/);
assert.doesNotMatch(latestTwentyRepair, /record\.defaultAnimation\.trim\(\)/);
assert.match(latestTwentyRepair, /choosePreviewAnimation\(\[\],record\?\.defaultAnimation\)/);
assert.match(latestTenRepair, /choosePreviewAnimation\(\[\],record\?\.defaultAnimation\)/);
assert.doesNotMatch(latestTenRepair, /String\(record\?\.defaultAnimation\|\|""\)\.trim\(\)/);
assert.doesNotMatch(latestTenRepair, /String\(animation\|\|record\?\.defaultAnimation\|\|""\)\.trim\(\)/);
assert.doesNotMatch(reportedRepair, /\.\.\.matrix\.map\(x=>"\/"+x\.previewPath/);
assert.doesNotMatch(latestTwentyRepair, /\.\.\.matrix\.map\(x=>"\/"+x\.previewPath/);
assert.match(latestTwenty, /animationMatches:true/);
assert.match(latestTwentyRepair, /meta\?\.animationMatches===true/);
assert.ok(latestTen.includes('/scripts/lib/export-log-redaction.mjs'));
assert.ok(latestTwenty.includes('/scripts/lib/export-log-redaction.mjs'));
assert.doesNotMatch(latestTwenty, /m\.ok=true;\s*fs\.writeFileSync\(p,JSON\.stringify\(m\)\)/);

console.log('PASS preview audit privacy: masked manifests, opaque matrix slots, and ID-free diagnostics');
