import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { detectBinarySpineVersion, detectSkeletonVersion } from './spine-version-detect.mjs';
import { spinePlayerSourceBlocker } from './lib/spine-player-source-support.mjs';

function varint(n) {
  const bytes = [];
  while (n >= 128) {
    bytes.push((n & 127) | 128);
    n >>>= 7;
  }
  bytes.push(n);
  return Buffer.from(bytes);
}

function text(value) {
  const b = Buffer.from(value, 'utf8');
  return Buffer.concat([varint(b.length + 1), b]);
}
const modern = Buffer.concat([Buffer.from('01234567'), text('4.3.26'), Buffer.alloc(32)]);
const modern41 = Buffer.concat([Buffer.from([0,255,254,128,12,0,7,1]), text('4.1.24'), Buffer.alloc(12)]);
const legacy = Buffer.concat([text('legacy skeleton hash'), text('3.8.99'), Buffer.alloc(32)]);
const legacy21 = Buffer.concat([text('hash'), text('2.1.27'), Buffer.alloc(12)]);
assert.equal(detectBinarySpineVersion(modern), '4.3.26');
assert.equal(detectBinarySpineVersion(modern41), '4.1.24');
assert.equal(detectBinarySpineVersion(legacy), '3.8.99');
assert.equal(detectBinarySpineVersion(legacy21), '2.1.27');
assert.equal(detectBinarySpineVersion(Buffer.from([0,1,2,3,4])), 'unknown');
assert.equal(detectBinarySpineVersion(Buffer.concat([Buffer.alloc(8), text('../evil')])), 'unknown');
assert.equal(spinePlayerSourceBlocker('4.1-from-4.2.43', 'wolf.json'), null);
assert.equal(spinePlayerSourceBlocker('4.1.24', 'wolf.json'), null);
assert.equal(spinePlayerSourceBlocker('4.3.26', 'character.json'), null);
assert.equal(spinePlayerSourceBlocker('5.0.0', 'character.json'), 'UNSUPPORTED_SPINE_WEB_PLAYER_VERSION');
assert.equal(spinePlayerSourceBlocker('unknown', 'character.json'), 'SPINE_VERSION_UNKNOWN');

const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'spine-version-header-'));
try {
  const file = path.join(temp, 'character.skel');
  fs.writeFileSync(file, modern41);
  assert.equal(detectSkeletonVersion(file), '4.1.24');
  const json = path.join(temp, 'character.json');
  fs.writeFileSync(json, JSON.stringify({ skeleton: { spine: '4.2.41' } }));
  assert.equal(detectSkeletonVersion(json), '4.2.41');
  fs.writeFileSync(json, '{broken');
  assert.equal(detectSkeletonVersion(json), 'unknown');
} finally {
  fs.rmSync(temp, { recursive: true, force: true });
}
console.log('SPINE_BINARY_VERSION_HEADER_TESTS_PASSED');
