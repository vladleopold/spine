import assert from 'node:assert/strict';
import fs from 'node:fs';
import { collectPreviewManifestSecrets, previewManifestMaskCommands } from './lib/preview-manifest-redaction.mjs';
import { escapeWorkflowCommandValue } from './lib/export-log-redaction.mjs';
import { choosePreviewAnimation } from './preview-animation-choice.mjs';
import {
  applyFrozenRenderSlots,
  previewManifestDigest,
  preparePreviewManifest,
  preparePreviewSlot,
} from './lib/preview-manifest-transport.mjs';

function section(source, start, end) {
  const startAt = source.indexOf(start);
  assert.notEqual(startAt, -1, 'missing section start: ' + start);
  const endAt = end ? source.indexOf(end, startAt + start.length) : -1;
  return source.slice(startAt, endAt < 0 ? undefined : endAt);
}

const sample = [{
  repairSlot: 0,
  id: 'private-upload-001',
  basePath: 'library_02',
  previewPath: 'library_02/private-upload-001',
  animation: 'Private Walk',
  sourceFingerprint: 'f'.repeat(64),
  ready: true,
  needsRender: true,
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

const frozen = applyFrozenRenderSlots(sample, [0]);
const digest = previewManifestDigest(frozen);
assert.equal(previewManifestDigest(frozen.map((entry) => ({
  ...entry, ready: false, blockedReason: 'source-directory-hydration-difference',
}))), digest,
  'manifest identity must remain stable when post-checkout source readiness is re-evaluated');
const preparedManifest = preparePreviewManifest(frozen, digest);
assert.ok(preparedManifest.maskCommands.includes('::add-mask::' + escapeWorkflowCommandValue(JSON.stringify(frozen)) + '\n'));
assert.ok(preparedManifest.envContent.startsWith('REPAIR_IDS_JSON<<'));
assert.ok(preparedManifest.envContent.includes(JSON.stringify(frozen)));
assert.throws(() => preparePreviewManifest(frozen, '0'.repeat(64)), /changed between jobs/);

const preparedSlot = preparePreviewSlot(frozen, 0, digest);
for (const value of ['private-upload-001', 'library_02/private-upload-001', 'Private Walk']) {
  assert.ok(preparedSlot.maskCommands.includes('::add-mask::' + escapeWorkflowCommandValue(value) + '\n'));
}
for (const name of ['ENTRY_ID<<', 'ENTRY_PATH<<', 'PREVIEW_PATH<<', 'ENTRY_ANIMATION<<', 'ENTRY_READY<<', 'ENTRY_NEEDS_RENDER<<']) {
  assert.ok(preparedSlot.envContent.includes(name), 'slot transport must export ' + name);
}
assert.throws(() => applyFrozenRenderSlots(sample, [0, 0]), /Invalid frozen render-slot list/);
assert.throws(() => applyFrozenRenderSlots(sample, [99]), /Invalid frozen render-slot list/);

const reportScript = fs.readFileSync(new URL('./verify-reported-preview-live.mjs', import.meta.url), 'utf8');
const reportLogs = reportScript.split('\n').filter((line) => /console\.(?:log|error)/.test(line));
assert.ok(reportLogs.length > 0);
assert.ok(reportLogs.every((line) => !/\bid\b/.test(line)),
  'reported-preview audit logs must use numeric slots, never upload IDs');

const reported = fs.readFileSync(new URL('../.github/workflows/repair-reported-previews.yml', import.meta.url), 'utf8');
const latestTen = fs.readFileSync(new URL('../.github/workflows/repair-last-ten-previews.yml', import.meta.url), 'utf8');
const latestTwenty = fs.readFileSync(new URL('../.github/workflows/repair-latest-twenty-previews.yml', import.meta.url), 'utf8');
const reportedRepair = fs.readFileSync(new URL('./repair-reported-previews.mjs', import.meta.url), 'utf8');
const latestTwentyRepair = fs.readFileSync(new URL('./repair-latest-twenty-previews.mjs', import.meta.url), 'utf8');
const latestTenRepair = fs.readFileSync(new URL('./repair-last-ten-previews.mjs', import.meta.url), 'utf8');

assert.match(reported, /pull_request:/);
assert.match(reported, /  inventory:\n    permissions:\n      contents: read/);

for (const [label, workflow, scriptName] of [
  ['reported18', reported, 'repair-reported-previews.mjs'],
  ['latest10', latestTen, 'repair-last-ten-previews.mjs'],
  ['latest20', latestTwenty, 'repair-latest-twenty-previews.mjs'],
]) {
  assert.match(workflow, /manifestSha256: \$\{\{ steps\.latest\.outputs\.manifestSha256 \}\}/,
    label + ' must publish only a non-reversible manifest digest');
  assert.match(workflow, /renderSlots: \$\{\{ steps\.latest\.outputs\.renderSlots \}\}/,
    label + ' must pass only numeric render slots between jobs');
  assert.doesNotMatch(workflow, /allEntries:\s*\$\{\{/,
    label + ' must not expose the full manifest as a job output');
  assert.doesNotMatch(workflow, /sparseCheckout:\s*\$\{\{/,
    label + ' must not expose private source paths as a job output');
  assert.doesNotMatch(workflow, /REPAIR_IDS_JSON:\s*\$\{\{/,
    label + ' must not put the private manifest in job-level environment');
  assert.doesNotMatch(workflow, /ENTRY_ID:\s*\$\{\{\s*matrix\.entry/,
    label + ' must not put private upload IDs in matrix environment');
  assert.doesNotMatch(workflow, /PREVIEW_PATH:\s*\$\{\{\s*matrix\.entry/,
    label + ' must not put private source paths in matrix environment');
  assert.doesNotMatch(workflow, /ENTRY_PATH:\s*\$\{\{\s*matrix\.entry/,
    label + ' must not put private source paths in matrix environment');
  assert.doesNotMatch(workflow, /ENTRY_ANIMATION:\s*\$\{\{\s*matrix\.entry/,
    label + ' must not put private animation names in matrix environment');
  assert.match(workflow, new RegExp('node scripts/' + scriptName + ' prepare-slot'));
  assert.match(workflow, new RegExp('node scripts/' + scriptName + ' prepare-manifest'));
  assert.match(workflow, /EXPECTED_MANIFEST_SHA256: \$\{\{ needs\.inventory\.outputs\.manifestSha256 \}\}/);
  assert.match(workflow, /RENDER_SLOTS_JSON: \$\{\{ needs\.inventory\.outputs\.renderSlots \}\}/);
  assert.match(workflow, /node scripts\/test-preview-log-privacy\.mjs/);
  assert.ok(workflow.includes('scripts/lib/preview-manifest-transport.mjs'),
    label + ' workflow path filter must include the transport helper');

  const render = section(workflow, '  render:', '  publish:');
  assert.ok(render.indexOf('prepare-slot') < render.indexOf('Hydrate exact source'),
    label + ' must mask metadata before source hydration');
  const publish = section(workflow, '  publish:', '  verify-production:');
  assert.ok(publish.indexOf('prepare-manifest') < publish.indexOf('Hydrate exact'),
    label + ' must mask metadata before any later step receives it');
}

const reportedRender = section(reported, '  render:', '  publish:');
assert.match(reportedRender, /name: validate-reported-preview-\$\{\{ matrix\.entry\.repairSlot \}\}/);
assert.match(reportedRender, /name: reported18-\$\{\{ matrix\.entry\.repairSlot \}\}/);
assert.doesNotMatch(reportedRender, /name:.*matrix\.entry\.id/);
assert.doesNotMatch(reportedRender, /\/\$\{\{ matrix\.entry\.previewPath \}\}\//);

const latestTwentyRender = section(latestTwenty, '  render:', '  publish:');
assert.match(latestTwentyRender, /name: validate-latest20-\$\{\{ matrix\.entry\.repairSlot \}\}/);
assert.match(latestTwentyRender, /name: latest20-\$\{\{ matrix\.entry\.repairSlot \}\}/);
assert.doesNotMatch(latestTwentyRender, /name:.*matrix\.entry\.id/);
assert.doesNotMatch(latestTwentyRender, /\/\$\{\{ matrix\.entry\.previewPath \}\}\//);

assert.match(latestTen, /name: validate-recovery-\$\{\{ matrix\.entry\.repairSlot \}\}/);
assert.match(latestTen, /name: latest10-\$\{\{ matrix\.entry\.repairSlot \}\}/);
for (const script of [reportedRepair, latestTenRepair, latestTwentyRepair]) {
  assert.match(script, /prepare-manifest/);
  assert.match(script, /prepare-slot/);
  assert.match(script, /previewManifestDigest\(selected\)!==expected/);
  assert.doesNotMatch(script, /console\.log\("allEntries=/);
  assert.doesNotMatch(script, /console\.log\("sparseCheckout/);
}
assert.match(reportedRepair, /reported18-"\+item\.repairSlot/);
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
assert.match(reportedRepair, /existingMediaOk\(entryInfo,selectedAnimation\)/);
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
assert.doesNotMatch(latestTwenty, /m\.ok=true;\s*fs\.writeFileSync\(p,JSON\.stringify\(m\)\)/);

for (const [label, workflow] of [['latest10', latestTen], ['latest20', latestTwenty]]) {
  const verify = section(workflow, '  verify-production:', '');
  assert.match(verify, /prepare-manifest/,
    label + ' production audit must prepare and mask its manifest before use');
  assert.doesNotMatch(verify, /REPAIR_IDS_JSON:\s*\$\{\{/,
    label + ' production audit must not receive a raw manifest in job-level env');
}

console.log('PASS preview audit privacy: opaque matrix slots, frozen digests, and masked GITHUB_ENV transport');
