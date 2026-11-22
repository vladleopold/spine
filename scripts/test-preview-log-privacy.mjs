import assert from 'node:assert/strict';
import fs from 'node:fs';
import { collectPreviewManifestSecrets, previewManifestMaskCommands, previewManifestEnvBlock } from './lib/preview-manifest-redaction.mjs';
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
  ENTRY_BASE_PATH: 'library_03',
  ENTRY_PATH: 'library_03/private-render-002',
  PREVIEW_PATH: 'library_03/private-render-002',
  ENTRY_ANIMATION: 'Private Run',
  ENTRY_READY: 'true',
  REPAIR_SLOT: '0',
};
const secrets = collectPreviewManifestSecrets(sample, raw, environment);
for (const value of [
  raw,
  'private-upload-001',
  'library_02/private-upload-001',
  'Private Walk',
  'f'.repeat(64),
  'private-render-002',
  'library_03',
  'library_03/private-render-002',
  'Private Run',
]) assert.ok(secrets.includes(value), 'missing sensitive manifest value');

const commands = previewManifestMaskCommands(sample, raw, environment);
for (const value of secrets) {
  assert.ok(commands.includes('::add-mask::' + escapeWorkflowCommandValue(value) + '\n'),
    'missing add-mask command for a sensitive value');
}

const exportedEnvironment = previewManifestEnvBlock({ ...environment, REPAIR_IDS_JSON: raw });
for (const key of ['REPAIR_IDS_JSON', 'ENTRY_ID', 'ENTRY_BASE_PATH', 'ENTRY_PATH', 'PREVIEW_PATH', 'ENTRY_ANIMATION', 'ENTRY_READY', 'REPAIR_SLOT']) {
  assert.match(exportedEnvironment, new RegExp('^' + key + '<<SPINE_PREVIEW_ENV_' + key + '_[a-f0-9]{20}$', 'm'),
    'sensitive workflow environment must be exported only through a masked GITHUB_ENV block');
}
assert.ok(exportedEnvironment.includes(raw), 'the exact manifest must remain available to later steps');

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

const maskScript = fs.readFileSync(new URL('./mask-preview-manifest.mjs', import.meta.url), 'utf8');
assert.match(maskScript, /previewManifestEnvBlock/);
assert.match(maskScript, /process\.env\.GITHUB_ENV/);
const maskCommandPosition = maskScript.indexOf('process.stdout.write(previewManifestMaskCommands');
const environmentExportPosition = maskScript.indexOf('fs.appendFileSync(process.env.GITHUB_ENV');
assert.ok(maskCommandPosition >= 0 && environmentExportPosition > maskCommandPosition,
  'all sensitive values must be masked before any manifest values enter GITHUB_ENV');

function jobLevelEnvironmentBlocks(workflow) {
  const lines = String(workflow).split(/\r?\n/);
  const blocks = [];
  for (let i = 0; i < lines.length; i++) {
    if (lines[i] !== '    env:') continue;
    const block = [];
    for (let j = i + 1; j < lines.length; j++) {
      if (/^    [A-Za-z0-9_-]+:\s*$/.test(lines[j]) || /^  [A-Za-z0-9_-]+:\s*$/.test(lines[j])) break;
      block.push(lines[j]);
    }
    blocks.push(block.join('\n'));
  }
  return blocks;
}

const sensitiveJobEnvironmentKey = /^\s*(?:REPAIR_IDS_JSON|ENTRY_ID|UPLOAD_ID|ENTRY_BASE_PATH|ENTRY_PATH|PREVIEW_PATH|ENTRY_ANIMATION|ANIMATION|SOURCE_PATH)\s*:/m;
const sensitiveWorkflowEnvironmentKey = sensitiveJobEnvironmentKey;
const unsafeJobEnvironmentFixture = [
  'jobs:',
  '  audit:',
  '    env:',
  '      NODE_ENV: test',
  '      REPAIR_IDS_JSON: private-manifest',
  '    steps:',
  '      - name: masked step',
  '        env:',
  '          ENTRY_ID: private-upload',
].join('\n');
const unsafeBlocks = jobLevelEnvironmentBlocks(unsafeJobEnvironmentFixture);
assert.equal(unsafeBlocks.length, 1, 'the regression fixture must expose one job-level env block');
assert.match(unsafeBlocks[0], sensitiveJobEnvironmentKey,
  'the guard must detect sensitive values even after ordinary env keys');
const unsafeStepEnvironmentFixture = [
  'jobs:', '  audit:', '    steps:', '      - name: mask', '        env:',
  '          NODE_ENV: test', '          ENTRY_ID: private-upload',
].join('\n');
assert.match(unsafeStepEnvironmentFixture, sensitiveWorkflowEnvironmentKey,
  'the regression must detect sensitive step-level env values before the masking command runs');

for (const [label, workflow] of [['latest-ten', latestTen], ['latest-twenty', latestTwenty]]) {
  const jobEnvBlocks = jobLevelEnvironmentBlocks(workflow);
  assert.ok(jobEnvBlocks.every(block => !sensitiveJobEnvironmentKey.test(block)),
    label + ' must not expose private manifest values in job-level environment');
  assert.doesNotMatch(workflow, sensitiveWorkflowEnvironmentKey,
    label + ' must not expose private IDs, paths, or animation names in any step/job env block');
  const script = label === 'latest-ten' ? 'repair-last-ten-previews.mjs' : 'repair-latest-twenty-previews.mjs';
  assert.ok(workflow.includes('node scripts/' + script + ' prepare "$REPAIR_SLOT"'),
    label + ' must derive and mask one source entry before exporting its environment');
  assert.ok(workflow.includes('node scripts/' + script + ' prepare-all'),
    label + ' must derive and mask the publish/audit manifest without a sensitive env block');
  assert.ok(workflow.includes('SPINE_PREPARE_HYDRATE'),
    label + ' must hydrate source directories only after the prepare script masks them');
  assert.doesNotMatch(workflow, /needs\\.inventory\\.outputs\\.allEntries/,
    label + ' must not pass private manifest data through cross-job environment expressions');
  assert.doesNotMatch(workflow, /sparse-checkout:\\s*\\$\\{\\{\\s*needs\\.inventory\\.outputs\\.sparseCheckout\\s*\\}\\}/,
    label + ' must not print per-upload source paths in checkout inputs');
}
assert.doesNotMatch(reported, /sparse-checkout:\s*\$\{\{\s*needs\.inventory\.outputs\.sparseCheckout\s*\}\}/,
  'reported batch must not print per-upload source paths in checkout inputs');
assert.ok(!reported.includes('REPAIR_IDS_JSON'));
for (const value of [
  'ENTRY_ID: ${{ matrix.entry.id }}',
  'ENTRY_BASE_PATH: ${{ matrix.entry.basePath }}',
  'PREVIEW_PATH: ${{ matrix.entry.previewPath }}',
  'ENTRY_ANIMATION: ${{ matrix.entry.animation }}',
]) assert.ok(!reported.includes(value), 'reported workflow must not expose source metadata in job env');
assert.ok(reported.includes('node scripts/repair-reported-previews.mjs prepare "$REPAIR_SLOT"'));
assert.ok(reported.includes('node scripts/repair-reported-previews.mjs prepare-all'));
assert.ok(reportedRepair.includes('::add-mask::'));
assert.ok(reportedRepair.includes('process.env.GITHUB_ENV'));
for (const source of [latestTenRepair, latestTwentyRepair]) {
  assert.ok(source.includes('previewManifestMaskCommands'));
  assert.ok(source.includes('previewManifestEnvBlock'));
  assert.ok(source.includes('function prepareSlot'));
  assert.ok(source.includes('function prepareAll'));
  assert.ok(source.includes('meta?.sourceFingerprint'));
  assert.ok(source.includes('meta?.animationHash'));
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
assert.ok(latestTen.includes('/scripts/'), 'latest-10 checkout includes the full scripts tree, including imported redaction helpers');
assert.ok(latestTwenty.includes('/scripts/'), 'latest-20 checkout includes the full scripts tree, including imported redaction helpers');
assert.doesNotMatch(latestTwenty, /m\.ok=true;\s*fs\.writeFileSync\(p,JSON\.stringify\(m\)\)/);

console.log('PASS preview audit privacy: no sensitive step/job env, masked prepare actions, source-bound media artifacts');
