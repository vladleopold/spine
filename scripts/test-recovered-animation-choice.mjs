import assert from 'node:assert/strict';
import fs from 'node:fs';
import { chooseRecoveryAnimation } from './lib/recovered-animation-choice.mjs';

assert.equal(
  chooseRecoveryAnimation('requested-but-not-in-runtime-list', 'indexed-default'),
  'requested-but-not-in-runtime-list',
  'an explicit animation name must be preserved even when runtime discovery cannot list it',
);
assert.equal(
  chooseRecoveryAnimation('', 'indexed-default'),
  'indexed-default',
  'an empty CLI argument may use only the exact indexed default',
);
assert.equal(
  chooseRecoveryAnimation('  exact name  ', 'indexed-default'),
  '  exact name  ',
  'animation names must not be trimmed or rewritten',
);
assert.equal(chooseRecoveryAnimation('', ''), '',
  'absence of an explicit and indexed animation must stay blocked');
assert.equal(chooseRecoveryAnimation(undefined, undefined), '',
  'missing animation metadata must not select the first available track');

assert.equal(
  chooseRecoveryAnimation('__SPINE_AUTO__', '', 'RuntimeIdle'),
  'RuntimeIdle',
  'auto-discovery must persist the exact track selected by the live renderer',
);
assert.equal(
  chooseRecoveryAnimation('__SPINE_AUTO__', 'indexed-default', ''),
  'indexed-default',
  'auto-discovery may fall back only to an exact indexed default when no runtime marker exists',
);
assert.equal(
  chooseRecoveryAnimation('__SPINE_AUTO__', '', ''),
  '',
  'auto-discovery must remain blocked if the renderer did not report its selected track',
);

const recoverySource = fs.readFileSync(new URL('./recover-recorded-webm.mjs', import.meta.url), 'utf8');
assert.match(recoverySource, /chooseRecoveryAnimation\(/,
  'the recovery script must use the tested exact-selection helper');
assert.doesNotMatch(recoverySource, /animations\?\.\[0\]/,
  'the recovery script must never select the first animation as a fallback');

console.log('PASS recorded-WebM recovery preserves only the explicit or indexed animation; no first-track fallback');

assert.match(recoverySource, /process\.argv\[5\]/,
  'recovery must receive the private renderer log to recover the actual selected animation');
assert.match(recoverySource, /SPINE_SELECTED_ANIMATION_B64/,
  'recovery must prefer the exact track reported by the renderer');

const latest50Workflow = fs.readFileSync(new URL('../.github/workflows/repair-latest-twenty-previews.yml', import.meta.url), 'utf8');
const latest10Workflow = fs.readFileSync(new URL('../.github/workflows/repair-last-ten-previews.yml', import.meta.url), 'utf8');
assert.match(latest50Workflow, /\$RUNNER_TEMP\/renderer\.log.*recovery\.log/);
assert.match(latest10Workflow, /\$RUNNER_TEMP\/renderer\.log.*recovery\.log/);
