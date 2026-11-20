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

const shortSample = [{ id: 'x1', basePath: 'library_02', previewPath: 'library_02/x', animation: 'Run' }];
const shortEnvironment = { ENTRY_ID: 'y2', ENTRY_ANIMATION: 'Run' };
const shortSecrets = collectPreviewManifestSecrets(shortSample, JSON.stringify(shortSample), shortEnvironment);
for (const value of ['x1', 'x', 'Run', 'y2']) {
  assert.ok(shortSecrets.includes(value), 'short private metadata values must be masked');
}
const shortCommands = previewManifestMaskCommands(shortSample, JSON.stringify(shortSample), shortEnvironment);
for (const value of shortSecrets) {
  assert.ok(shortCommands.includes('::add-mask::' + escapeWorkflowCommandValue(value) + '\n'),
    'short values must receive add-mask commands');
}

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
const latestTenAudit = fs.readFileSync(new URL('./lib/latest-ten-live-audit.mjs', import.meta.url), 'utf8');
const latestTwentyAudit = fs.readFileSync(new URL('./verify-latest-twenty-live.mjs', import.meta.url), 'utf8');

function jobLevelSensitiveEnvKeys(source) {
  const sensitive = new Set(['ENTRY_ID', 'ENTRY_PATH', 'PREVIEW_PATH', 'ENTRY_ANIMATION', 'REPAIR_IDS_JSON', 'UPLOAD_ID']);
  const leaks = [];
  let inJobEnv = false;
  for (const line of source.split(/\r?\n/)) {
    if (/^    env:\s*$/.test(line)) {
      inJobEnv = true;
      continue;
    }
    if (inJobEnv && /^\s{0,4}\S/.test(line)) inJobEnv = false;
    if (inJobEnv) {
      const match = line.match(/^\s{6}([A-Z0-9_]+):/);
      if (match && sensitive.has(match[1])) leaks.push(match[1]);
    }
  }
  return leaks;
}

assert.match(reported, /pull_request:/);
assert.match(reported, /  inventory:\n    permissions:\n      contents: read/);

for (const workflow of [reported, latestTen, latestTwenty]) {
  assert.ok(workflow.includes('node scripts/mask-preview-manifest.mjs'),
    'every manifest-consuming workflow must mask before use');
  assert.deepEqual(jobLevelSensitiveEnvKeys(workflow), [],
    'private IDs, paths, animation names, and manifests must never be job-level env');
  const stepManifests = workflow.match(/^ {8}env:\s*\n(?:^ {10}[^\n]*\n)*^ {10}REPAIR_IDS_JSON:/gm) || [];
  assert.ok(stepManifests.length >= 2,
    'render/publish/verify manifests must be supplied only to masking steps');
  assert.ok(workflow.includes('>> "$GITHUB_ENV"'),
    'masked values needed by later steps must be persisted only after add-mask commands');
  assert.match(workflow, /group: spine-preview-repair-\$\{\{ github\.ref \}\}/,
    'overlapping repair workflows must serialize on the same branch-scoped lock');
}

const reportedRender = reported.slice(reported.indexOf('  render:'), reported.indexOf('  publish:'));
assert.match(reportedRender, /name: validate-reported-preview-\$\{\{ matrix\.entry\.repairSlot \}\}/);
assert.match(reportedRender, /name: reported18-\$\{\{ matrix\.entry\.repairSlot \}\}/);
assert.match(reportedRender, /name: Mask private metadata and hydrate exact source\n\s+env:\n\s+ENTRY_ID:/);
assert.doesNotMatch(reportedRender, /name:.*matrix\.entry\.id/);
assert.doesNotMatch(reportedRender, /\/\$\{\{ matrix\.entry\.previewPath \}\}\//);

const latestTwentyRender = latestTwenty.slice(latestTwenty.indexOf('  render:'), latestTwenty.indexOf('  publish:'));
assert.match(latestTwentyRender, /name: validate-latest20-\$\{\{ matrix\.entry\.repairSlot \}\}/);
assert.match(latestTwentyRender, /name: latest20-\$\{\{ matrix\.entry\.repairSlot \}\}/);
assert.match(latestTwentyRender, /name: Mask private metadata and hydrate exact source\n\s+env:\n\s+ENTRY_ID:/);
assert.doesNotMatch(latestTwentyRender, /name:.*matrix\.entry\.id/);
assert.doesNotMatch(latestTwentyRender, /\/\$\{\{ matrix\.entry\.previewPath \}\}\//);

const latestTenPush = latestTen.slice(latestTen.indexOf('  push:'), latestTen.indexOf('  workflow_dispatch:'));
assert.doesNotMatch(latestTenPush, /repair-last-ten-previews\.yml/,
  'latest-ten must not auto-run alongside the superset latest-twenty workflow on the same merge');
assert.match(latestTen, /name: validate-recovery-\$\{\{ matrix\.entry\.repairSlot \}\}/);
assert.match(latestTen, /name: latest10-\$\{\{ matrix\.entry\.repairSlot \}\}/);
assert.match(latestTen, /name: Mask private source metadata and hydrate exact source\n\s+env:\n\s+ENTRY_ID:/);

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
assert.ok(latestTen.includes('/scripts/lib/export-log-redaction.mjs'));
assert.ok(latestTwenty.includes('/scripts/lib/export-log-redaction.mjs'));
assert.doesNotMatch(latestTwenty, /m\.ok=true;\s*fs\.writeFileSync\(p,JSON\.stringify\(m\)\)/);
assert.doesNotMatch(latestTenAudit, /item\.animation\.trim\(\)/,
  'live audit must not normalize the exact animation string');
assert.doesNotMatch(latestTwentyAudit, /record\.defaultAnimation.*\.trim\(\)/,
  'live audit must not normalize the exact default animation');
assert.match(latestTwentyAudit, /hasExactDefaultAnimation/);

console.log('PASS preview audit privacy: masked manifests, step-scoped secrets, serialized repair batches, and exact animation identity');
