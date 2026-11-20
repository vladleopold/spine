import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  buildAnimationIndexMatrix,
  mergeFullExportMetadata,
  resolveAnimationIndex,
} from './lib/spine-export-matrix.mjs';
import {collectSensitiveExportValues,escapeWorkflowCommandValue} from './lib/export-log-redaction.mjs';
import { listCollectionFolders, readIndex } from './resolve-library.mjs';

const redactionFixture = {
  id: 'private-upload-1234',
  previewPath: 'library_02/private-work',
  skeleton: 'sets/private-skeleton.skel',
  atlas: 'sets/private.atlas',
  textures: ['textures/private-page.png'],
  files: [{ name: 'private-file.png', path: 'sets/private-file.png' }],
  animations: ['private animation'],
  defaultAnimation: 'private animation',
  allAnimationPreviews: {
    'private animation': { webmPreview: 'https://private.example/private-work/preview.webm' },
  },
  previewStatus: 'ready',
};
const redactedValues = new Set(collectSensitiveExportValues(redactionFixture));
for (const value of [
  'private-upload-1234', 'private-work', 'private-skeleton.skel',
  'private.atlas', 'private-page.png', 'private-file.png',
  'private animation', 'https://private.example/private-work/preview.webm',
]) {
  assert.equal(redactedValues.has(value), true,
    'sensitive export metadata must be masked before renderer diagnostics');
}
assert.equal(redactedValues.has('ready'), false,
  'public status codes remain visible for useful diagnostics');
assert.equal(
  escapeWorkflowCommandValue('private%value\r\nnext'),
  'private%25value%0D%0Anext',
  'workflow command values must be escaped safely',
);

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
const validationJob = workflow.split('  validate-contract:')[1]?.split('  generate-matrix:')[0] || '';
const prepareRender = fs.readFileSync(new URL('./prepare-render.mjs', import.meta.url), 'utf8');
const matrixScript = fs.readFileSync(new URL('./spine-export-matrix.mjs', import.meta.url), 'utf8');
const resolverScript = fs.readFileSync(new URL('./resolve-export-animation.mjs', import.meta.url), 'utf8');

assert.match(matrixScript, /buildAnimationIndexMatrix/);
assert.match(matrixScript, /matrix=\$\{JSON\.stringify\(result\.matrix\)\}/);
assert.doesNotMatch(matrixScript, /matrix:\s*entry\.animations\s*[,}]/);
assert.match(resolverScript, /resolveAnimationIndex/);
assert.match(resolverScript, /SPINE_ANIMATION_B64/);
assert.ok(resolverScript.includes('escapeWorkflowCommandValue(selection.animation)'));
assert.ok(prepareRender.includes('collectSensitiveExportValues'));
assert.ok(prepareRender.includes('escapeWorkflowCommandValue'));
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
assert.match(workflow, /scripts\/lib\/export-log-redaction\.mjs/);
assert.match(workflow, /scripts\/prepare-render\.mjs/);
assert.ok(validationJob.includes('sparse-checkout-cone-mode: false'));
assert.ok(validationJob.includes('/scripts/'));
assert.ok(validationJob.includes('/.github/workflows/spine-export-full.yml'));
assert.ok(!validationJob.includes('/library'), 'contract-only validation must not fetch library media');
assert.ok(workflow.includes('needs: [generate-matrix, export-opaque, export-alpha]'));
assert.ok(workflow.includes("needs.generate-matrix.outputs.has-items == 'true'"));
const uploadIdExpression = String.fromCharCode(36) + '{{ github.event.client_payload.uploadId }}';
const runIdExpression = String.fromCharCode(36) + '{{ github.run_id }}';
assert.ok(!workflow.includes('full-opaque-' + uploadIdExpression));
assert.ok(!workflow.includes('full-alpha-' + uploadIdExpression));
assert.ok(workflow.includes('full-opaque-' + runIdExpression));
assert.ok(workflow.includes('full-alpha-' + runIdExpression));
const rawUploadCommit = 'Full export: all animations + alpha for ' + String.fromCharCode(36) + '{UPLOAD_ID}';
assert.ok(!workflow.includes(rawUploadCommit));
assert.ok(!workflow.includes('Upload ID |'));
assert.ok(!workflow.includes('ls -lah "$DIR/"'));
assert.match(workflow, /ARTIFACT_FILE_COUNT/);

console.log('PASS full-export matrix uses numeric indexes and preserves the exact selected animation');
