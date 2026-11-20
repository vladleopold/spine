import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { previewSourceFingerprint } from './repair-manifest-guard.mjs';
import {
  SOURCE_PRESERVATION_CASES,
  animationFingerprint,
  resolveSourcePreservationCase,
} from './lib/source-preservation-case.mjs';

const fixture = {
  id: 'synthetic-upload-001',
  uploadedAt: '2026-11-20T00:00:00.000Z',
  previewPath: 'library_02/synthetic-upload-001',
  files: ['synthetic.skel', 'synthetic.atlas', 'synthetic.png'],
  skeleton: 'synthetic.skel',
  atlas: 'synthetic.atlas',
  textures: ['synthetic.png'],
  animations: ['synthetic-run', 'synthetic-idle'],
  defaultAnimation: 'synthetic-run',
};
const fixtureCase = {
  sourceFingerprint: previewSourceFingerprint(fixture),
  animationIndex: 0,
  animationFingerprint: animationFingerprint('synthetic-run'),
};
const resolved = resolveSourcePreservationCase([fixture], 0, [fixtureCase]);
assert.equal(resolved.status, 'ready');
assert.equal(resolved.animation, 'synthetic-run');
assert.equal(resolved.sourceDir, 'library_02/synthetic-upload-001');

assert.equal(resolveSourcePreservationCase([fixture], 0, [{
  ...fixtureCase,
  animationIndex: 1,
}]).status, 'blocked', 'a changed index must not substitute another animation');
assert.equal(resolveSourcePreservationCase([{
  ...fixture,
  defaultAnimation: 'synthetic-idle',
}], 0, [fixtureCase]).status, 'blocked', 'a changed default must remain blocked');
assert.equal(resolveSourcePreservationCase([{
  ...fixture,
  animations: ['synthetic-idle'],
}], 0, [fixtureCase]).status, 'blocked',
  'a missing exact animation must not fall back to the first available animation');
assert.equal(resolveSourcePreservationCase([fixture, fixture], 0, [fixtureCase]).status, 'blocked',
  'ambiguous source fingerprints must be rejected');
assert.equal(resolveSourcePreservationCase([{ ...fixture, testOnly: true }], 0, [fixtureCase]).status, 'blocked');
assert.equal(resolveSourcePreservationCase([fixture], 'invalid', [fixtureCase]).status, 'blocked');

assert.equal(SOURCE_PRESERVATION_CASES.length, 2);
for (const spec of SOURCE_PRESERVATION_CASES) {
  assert.match(spec.sourceFingerprint, /^[a-f0-9]{64}$/);
  assert.match(spec.animationFingerprint, /^[a-f0-9]{64}$/);
  assert.equal(Number.isSafeInteger(spec.animationIndex), true);
  assert.deepEqual(Object.keys(spec).sort(), [
    'animationFingerprint', 'animationIndex', 'sourceFingerprint',
  ]);
}

const workflow = readFileSync(new URL('../.github/workflows/canvas-recovery-e2e.yml', import.meta.url), 'utf8');
const matrix = workflow.split('      matrix:')[1]?.split('    steps:')[0] || '';
assert.ok(matrix.includes('case_index: [0, 1]'));
assert.ok(!matrix.includes('animation:'));
assert.ok(!matrix.includes('id:'));
assert.ok(!workflow.includes('matrix.animation'));
assert.ok(!workflow.includes('matrix.id'));
const libraryPaths = workflow.split('\n')
  .map((line) => line.trim())
  .filter((line) => line.startsWith('/library_02/'));
assert.deepEqual(libraryPaths, ['/library_02/index.json']);
assert.ok(workflow.includes('scripts/resolve-source-preservation-case.mjs'));
assert.ok(workflow.includes('scripts/test-source-preservation-case.mjs'));

const resolver = readFileSync(new URL('./resolve-source-preservation-case.mjs', import.meta.url), 'utf8');
assert.ok(resolver.includes('collectSensitiveExportValues'));
assert.ok(resolver.includes('::add-mask::'));
assert.ok(resolver.includes('resolveSourcePreservationCase'));
assert.ok(!resolver.includes('console.log(resolved.entry'));
console.log('PASS exact source-preserving cases use opaque fingerprints and never substitute animations');
