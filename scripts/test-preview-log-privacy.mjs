#!/usr/bin/env node
import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  collectPreviewManifestSecrets,
  previewManifestEnvBlock,
  previewManifestMaskCommands,
} from './lib/preview-manifest-redaction.mjs';
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
  REPAIR_IDS_JSON: raw,
  ENTRY_ID: 'private-render-002',
  ENTRY_BASE_PATH: 'library_03',
  ENTRY_PATH: 'library_03/private-render-002',
  PREVIEW_PATH: 'library_03/private-render-002',
  ENTRY_ANIMATION: 'Private Run',
  ENTRY_READY: 'true',
  ENTRY_NEEDS_RENDER: 'true',
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

const envBlock = previewManifestEnvBlock(environment);
for (const key of [
  'REPAIR_IDS_JSON', 'ENTRY_ID', 'ENTRY_BASE_PATH', 'ENTRY_PATH',
  'PREVIEW_PATH', 'ENTRY_ANIMATION', 'ENTRY_READY', 'ENTRY_NEEDS_RENDER', 'REPAIR_SLOT',
]) {
  assert.match(envBlock, new RegExp('^' + key + '<<SPINE_PREVIEW_ENV_' + key + '_[a-f0-9]{20}$', 'm'),
    'sensitive workflow environment must be exported through a masked GITHUB_ENV block');
}
assert.ok(envBlock.includes(raw), 'the exact manifest must remain available to later steps');

const maskScript = fs.readFileSync(new URL('./mask-preview-manifest.mjs', import.meta.url), 'utf8');
assert.match(maskScript, /previewManifestEnvBlock/);
assert.match(maskScript, /process\.env\.GITHUB_ENV/);
const maskCommandPosition = maskScript.indexOf('process.stdout.write(previewManifestMaskCommands');
const environmentExportPosition = maskScript.indexOf('fs.appendFileSync(process.env.GITHUB_ENV');
assert.ok(maskCommandPosition >= 0 && environmentExportPosition > maskCommandPosition,
  'all sensitive values must be masked before any manifest values enter GITHUB_ENV');

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
for (const [label, workflow] of [['reported', reported], ['latest-ten', latestTen]]) {
  assert.ok(workflow.includes('node scripts/mask-preview-manifest.mjs'),
    label + ' must mask private manifest values before use');
  const jobEnvBlocks = jobLevelEnvironmentBlocks(workflow);
  assert.ok(jobEnvBlocks.every(block => !sensitiveJobEnvironmentKey.test(block)),
    label + ' must not expose private manifest values in job-level environment');
  assert.match(workflow, /name: Mask private source metadata and hydrate exact source\n        env:\n          ENTRY_ID:/,
    label + ' render metadata must be scoped to the masking step');
  assert.match(workflow, /name: Mask and hydrate exact(?: latest-20| reported)? source directories\n        env:\n          REPAIR_IDS_JSON:/,
    label + ' publish manifest must be scoped to the masking step');
  assert.doesNotMatch(workflow, /sparse-checkout:\s*\$\{\{\s*needs\.inventory\.outputs\.sparseCheckout\s*\}\}/,
    label + ' must not print per-upload paths in checkout inputs');
  assert.ok(workflow.includes('node scripts/test-preview-log-privacy.mjs'),
    label + ' must execute the privacy regression');
}
assert.ok(latestTwenty.includes('node scripts/mask-preview-manifest.mjs'));
assert.match(latestTwenty, /name: Mask and hydrate exact latest-20 source directories\n        env:\n          REPAIR_IDS_FILE:/,
  'latest-50 publish manifest must be loaded from a private artifact file');
assert.match(latestTwenty, /name: Mask exact production audit manifest\n        env:\n          REPAIR_IDS_FILE:/,
  'latest-50 production audit manifest must be loaded from a private artifact file');
assert.ok(latestTwenty.includes('name: latest50-manifest'));
assert.ok(latestTwenty.includes('path: repair-manifest.json'));
assert.match(latestTen, /name: Mask exact production audit manifest\n        env:\n          REPAIR_IDS_JSON:/,
  'latest-10 production audit manifest must remain scoped to its masking step');

const reportedRender = reported.slice(reported.indexOf('  render:'), reported.indexOf('  publish:'));
assert.match(reportedRender, /name: validate-reported-preview-\$\{\{ matrix\.entry\.repairSlot \}\}/);
assert.match(reportedRender, /name: reported18-\$\{\{ matrix\.entry\.repairSlot \}\}/);
assert.doesNotMatch(reportedRender, /name:.*matrix\.entry\.id/);
assert.doesNotMatch(reportedRender, /\/\$\{\{ matrix\.entry\.previewPath \}\}\//);

const latestTwentyRender = latestTwenty.slice(latestTwenty.indexOf('  render:'), latestTwenty.indexOf('  publish:'));
assert.match(latestTwentyRender, /name: validate-latest20-\$\{\{ matrix\.entry\.repairSlot \}\}/);
assert.match(latestTwentyRender, /name: latest20-\$\{\{ matrix\.entry\.repairSlot \}\}/);
assert.doesNotMatch(latestTwentyRender, /name:.*matrix\.entry\.id/);
assert.doesNotMatch(latestTwentyRender, /\/\$\{\{ matrix\.entry\.previewPath \}\}\//);

assert.match(latestTen, /name: validate-recovery-\$\{\{ matrix\.entry\.repairSlot \}\}/);
assert.match(latestTen, /name: latest10-\$\{\{ matrix\.entry\.repairSlot \}\}/);
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
assert.ok(latestTen.includes('/scripts/'),
  'latest-10 sparse checkout must include the scripts tree and its imported redaction helper');
assert.ok(latestTwenty.includes('/scripts/'),
  'latest-20 sparse checkout must include the scripts tree and its imported redaction helper');
assert.doesNotMatch(latestTwenty, /m\.ok=true;\s*fs\.writeFileSync\(p,JSON\.stringify\(m\)\)/);

console.log('PASS preview audit privacy: masked manifests, scoped workflow environments, opaque diagnostics');
