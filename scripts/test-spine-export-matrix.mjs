import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  buildAnimationIndexMatrix,
  mergeFullExportMetadata,
  resolveAnimationIndex,
} from './lib/spine-export-matrix.mjs';
import { listCollectionFolders, readIndex } from './resolve-library.mjs';

const source = {
  skeleton: 'source.skel',
  atlas: 'source.atlas',
  textures: ['page.png'],
  animations: ['walk', 'idle'],
  defaultAnimation: 'Missing',
};

const matrix = buildAnimationIndexMatrix(source);
assert.deepEqual(matrix, { matrix: [0, 1], hasItems: true });
assert.doesNotMatch(JSON.stringify(matrix.matrix), /walk|idle/,
  'matrix outputs must contain numeric indexes, never animation names');

assert.deepEqual(resolveAnimationIndex(source, 1), {
  status: 'ready',
  index: 1,
  animation: 'idle',
  safeName: 'animation-1',
});
assert.equal(resolveAnimationIndex(source, '0').animation, 'walk');
assert.equal(resolveAnimationIndex(source, -1).status, 'blocked');
assert.equal(resolveAnimationIndex(source, 2).status, 'blocked');
assert.equal(resolveAnimationIndex(source, '').status, 'blocked');
assert.equal(resolveAnimationIndex(source, ' ').status, 'blocked');
assert.equal(resolveAnimationIndex(source, 'not-an-index').status, 'blocked');

const whitespaceSelection = resolveAnimationIndex({
  ...source,
  animations: [' walk '],
}, 0);
assert.equal(whitespaceSelection.animation, ' walk ',
  'the exact source animation string must be preserved');

const previews = {
  walk: {
    previewDuration: 9,
    webmPreview: '/walk.webm',
  },
  idle: {
    previewDuration: 1.25,
    webmPreview: '/idle.webm',
  },
};

const missingDefault = mergeFullExportMetadata(source, previews, '2026-11-20T00:00:00.000Z');
assert.equal(missingDefault.defaultAnimation, 'Missing',
  'an unavailable explicit selection must remain unchanged');
assert.equal(missingDefault.previewDuration, undefined,
  'another animation duration must never become the selected preview duration');
assert.equal(missingDefault.fullExportStatus, 'partial');

const selectedDefault = mergeFullExportMetadata({
  ...source,
  defaultAnimation: 'idle',
}, previews, '2026-11-20T00:00:00.000Z');
assert.equal(selectedDefault.defaultAnimation, 'idle');
assert.equal(selectedDefault.previewDuration, 1.25,
  'work-level duration must come from the exact selected animation, not the longest track');

const noDefault = mergeFullExportMetadata({
  ...source,
  defaultAnimation: undefined,
}, previews, '2026-11-20T00:00:00.000Z');
assert.equal(noDefault.defaultAnimation, undefined);
assert.equal(noDefault.previewDuration, undefined);

// Exercise the numeric matrix against the repository's real public indexes without logging
// any work IDs or animation names. Each index must resolve back to its exact source string.
const realEntries = listCollectionFolders(process.cwd())
  .flatMap((folder) => readIndex(process.cwd(), folder) || []);
const realEntry = realEntries.find((entry) =>
  Array.isArray(entry?.animations) &&
  entry.animations.length > 0 &&
  typeof entry.skeleton === 'string' &&
  typeof entry.atlas === 'string' &&
  Array.isArray(entry.textures) &&
  entry.textures.length > 0,
);
assert.ok(realEntry, 'a source-backed archive entry is required for the matrix integration test');
const realMatrix = buildAnimationIndexMatrix(realEntry);
assert.equal(realMatrix.hasItems, true);
assert.deepEqual(realMatrix.matrix, realEntry.animations.map((_, index) => index));
for (let index = 0; index < realEntry.animations.length; index += 1) {
  const resolved = resolveAnimationIndex(realEntry, index);
  assert.equal(resolved.status, 'ready');
  assert.equal(resolved.animation, realEntry.animations[index]);
  assert.equal(resolved.safeName, `animation-${index}`);
}

const workflow = fs.readFileSync(new URL('../.github/workflows/spine-export-full.yml', import.meta.url), 'utf8');
const matrixScript = fs.readFileSync(new URL('./spine-export-matrix.mjs', import.meta.url), 'utf8');
const resolverScript = fs.readFileSync(new URL('./resolve-export-animation.mjs', import.meta.url), 'utf8');

assert.match(matrixScript, /buildAnimationIndexMatrix/);
assert.match(matrixScript, /matrix=\$\{JSON\.stringify\(result\.matrix\)\}/);
assert.doesNotMatch(matrixScript, /matrix:\s*entry\.animations\s*[,}]/);
assert.match(resolverScript, /resolveAnimationIndex/);
assert.match(resolverScript, /SPINE_ANIMATION_B64/);
assert.doesNotMatch(resolverScript, /console\.log\([^\n]*selection\.animation/);

assert.match(workflow, /validate-contract:/);
assert.match(workflow, /pull_request:/);
assert.match(workflow, /matrix:\s*\n\s+animation_index:/);
assert.match(workflow, /matrix\.animation_index/);
assert.match(workflow, /resolve-export-animation\.mjs/);
assert.match(workflow, /animation-index\.txt/);
assert.doesNotMatch(workflow, /anim-name\.txt/);
assert.doesNotMatch(workflow, /matrix\.animation(?!_index)/);
assert.match(workflow, /mergeFullExportMetadata/);
assert.doesNotMatch(workflow, /Automatic preview fallback|effectiveDefault|animOrder/,
  'full export must never switch the indexed/default animation');
assert.doesNotMatch(workflow, /Animations exported:[^\n]*join\(/,
  'workflow logs must not print source animation names');

console.log('PASS full-export matrix uses numeric indexes and preserves the exact selected animation');
