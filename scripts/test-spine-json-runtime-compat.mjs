import assert from 'node:assert/strict';
import { normalizeSpineJsonForLegacy38Runtime } from './lib/spine-json-runtime-compat.mjs';

const source = {
  skeleton: { spine: '3.8.75' },
  bones: [{ name: 'root' }],
  skins: {
    default: {
      attachments: {
        slot: {
          region: { type: 'region', path: 'body', width: 24, height: 32 },
        },
      },
    },
    custom: {
      name: 'custom-visible',
      attachments: {
        slot: {
          region: { type: 'region', path: 'custom-body', width: 12, height: 16 },
        },
      },
    },
  },
};
const sourceText = JSON.stringify(source);
const sourceBuffer = Buffer.from(sourceText);
const normalized = normalizeSpineJsonForLegacy38Runtime(sourceBuffer, '3.8.75');
const parsed = JSON.parse(normalized);

assert.ok(Array.isArray(parsed.skins),
  'Spine 3.8 object-map skins must be converted to the legacy runtime array format');
assert.deepEqual(parsed.skins.map((skin) => skin.name), ['default', 'custom-visible']);
assert.deepEqual(parsed.skins[0].attachments, source.skins.default.attachments,
  'normalization must preserve attachment payloads');
assert.deepEqual(parsed.skins[1].attachments, source.skins.custom.attachments,
  'normalization must preserve named skin attachments');
assert.equal(sourceBuffer.toString('utf8'), sourceText,
  'normalization must not mutate the uploaded source buffer');

const arraySource = JSON.stringify({
  skeleton: { spine: '3.8.75' },
  skins: [{ name: 'default', attachments: {} }],
});
assert.equal(normalizeSpineJsonForLegacy38Runtime(arraySource, '3.8.75'), arraySource,
  'already compatible skin arrays must remain byte-for-byte unchanged');

const modernSource = '{ "skeleton": { "spine": "4.2.00" }, "skins": { "default": {} } }';
assert.equal(normalizeSpineJsonForLegacy38Runtime(modernSource, '4.2.00'), modernSource,
  'modern runtimes must receive the original JSON unchanged');

assert.throws(
  () => normalizeSpineJsonForLegacy38Runtime('not-json', '3.8.75'),
  SyntaxError,
  'malformed 3.8 JSON must fail closed',
);
assert.throws(
  () => normalizeSpineJsonForLegacy38Runtime(JSON.stringify({ skins: { broken: null } }), '3.8.75'),
  /Invalid Spine 3.8 skin map entry/,
  'invalid skin-map values must fail closed rather than produce a partial skeleton',
);

console.log('SPINE_JSON_RUNTIME_COMPAT_TESTS_PASSED');
