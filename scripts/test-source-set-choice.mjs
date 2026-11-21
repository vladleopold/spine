import assert from 'node:assert/strict';
import { chooseSourceSet } from './lib/source-set-choice.mjs';

const first = { name: 'first', path: '/work/first', files: ['first.skel', 'first.atlas'] };
const second = { name: 'second', path: '/work/second', files: ['Target Rig.skel', 'Target Rig.atlas'] };
const other = { name: 'other', path: '/work/other', files: ['other.skel', 'other.atlas'] };

assert.equal(chooseSourceSet([first, second], ''), null,
  'multiple discovered sets must never select the first set implicitly');
assert.equal(chooseSourceSet([second], ''), second,
  'a sole discovered set is unambiguous when the index has no skeleton filename');
assert.equal(chooseSourceSet([first, second], 'Target Rig.skel'), second,
  'the exact indexed skeleton must win regardless of API/filesystem order');
assert.equal(chooseSourceSet([first, second], 'https://example.invalid/assets/Target%20Rig.json?v=3'), second,
  'encoded indexed paths and same-stem binary aliases resolve the same source set');
assert.equal(chooseSourceSet([first, second], 'Missing.skel'), null,
  'a missing indexed skeleton must block instead of choosing another set');
assert.equal(chooseSourceSet([first, { ...second, name: 'duplicate' }], 'Target Rig.skel'), null,
  'duplicate matching sets must be treated as ambiguous');
assert.equal(chooseSourceSet([first, second, other], 'first.skel'), first,
  'an exact source set may be selected from a larger directory list');

console.log('PASS exporter source-set selection: exact indexed set only; missing or ambiguous sets block');
