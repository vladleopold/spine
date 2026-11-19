import test from 'node:test';
import assert from 'node:assert/strict';
import { animationAssetPath, isPublicPreviewRepairCandidate } from './repair-archive-card-previews.mjs';
import { previewSourceFingerprint, repairRecordTimestamp, validateFrozenRepairRecord } from './repair-manifest-guard.mjs';
import { readFileSync } from 'node:fs';

const entry = { id: 'sp_hyjingx_data-2026-10-03T14-25-07-486Z' };
const previewPath = 'library_01/' + entry.id;
const animation = 'idle1';

test('maps legacy shard URL to the current library shard without changing the animation path', () => {
  const url = 'https://spine-link.vercel.app/assets/library/' + entry.id +
    '/animations/idle1/' + entry.id + '-anim-idle1-preview-medium.webm';
  assert.equal(
    animationAssetPath(url, entry, previewPath, animation, 'medium'),
    previewPath + '/animations/idle1/' + entry.id + '-anim-idle1-preview-medium.webm',
  );
});

test('accepts the current shard path and both supported filename styles', () => {
  const legacy = 'https://spine-link.vercel.app/assets/' + previewPath +
    '/animations/idle1/' + entry.id + '-anim-idle1-preview-low.webm';
  const modern = 'https://spine-link.vercel.app/assets/' + previewPath +
    '/animations/idle1/preview-medium.webm';
  assert.ok(animationAssetPath(legacy, entry, previewPath, animation, 'low'));
  assert.ok(animationAssetPath(modern, entry, previewPath, animation, 'medium'));
});

test('rejects cross-work, cross-animation, wrong-quality and non-site media URLs', () => {
  const wrongWork = 'https://spine-link.vercel.app/assets/library/other-work/animations/idle1/other-work-anim-idle1-preview-medium.webm';
  const wrongAnimation = 'https://spine-link.vercel.app/assets/library/' + entry.id +
    '/animations/walk/' + entry.id + '-anim-walk-preview-medium.webm';
  const wrongTier = 'https://spine-link.vercel.app/assets/library/' + entry.id +
    '/animations/idle1/' + entry.id + '-anim-idle1-preview-low.webm';
  const external = 'https://example.com/assets/library/' + entry.id +
    '/animations/idle1/' + entry.id + '-anim-idle1-preview-medium.webm';
  assert.equal(animationAssetPath(wrongWork, entry, previewPath, animation, 'medium'), '');
  assert.equal(animationAssetPath(wrongAnimation, entry, previewPath, animation, 'medium'), '');
  assert.equal(animationAssetPath(wrongTier, entry, previewPath, animation, 'medium'), '');
  assert.equal(animationAssetPath(external, entry, previewPath, animation, 'medium'), '');
});

test('archive preview repair inventory excludes hidden and test-only works', () => {
  const eligible = { webmStatus: 'ready', previewStatus: 'blocked' };
  assert.equal(isPublicPreviewRepairCandidate(eligible), true);
  assert.equal(isPublicPreviewRepairCandidate({ ...eligible, hiddenFromPublicLibrary: true }), false);
  assert.equal(isPublicPreviewRepairCandidate({ ...eligible, testOnly: true }), false);
  assert.equal(isPublicPreviewRepairCandidate({ ...eligible, previewStatus: 'ready' }), false);
  assert.equal(isPublicPreviewRepairCandidate({ ...eligible, webmStatus: 'blocked' }), false);
});

test('legacy preview paths without a shard prefix are normalized inside their index shard', () => {
  const record = {
    id: 'wild_1x3-2026-10-12T11-36-08-123Z',
    uploadedAt: '2026-10-12T11:36:08.123Z',
    previewPath: 'wild_1x3-2026-10-12T11-36-08-123Z',
    files: [],
  };
  const item = {
    id: record.id,
    basePath: 'library_02',
    previewPath: 'library_02/' + record.previewPath,
    uploadedAt: Date.parse(record.uploadedAt),
    sourceFingerprint: previewSourceFingerprint(record),
  };
  assert.equal(
    validateFrozenRepairRecord('/repo', item, ['library_02'], () => [record]).previewPath,
    item.previewPath,
  );
});

test('accepts the matching shard prefix and rejects a different shard', () => {
  const record = {
    id: 'legacy-path-2026-10-12T11-36-08-123Z',
    uploadedAt: '2026-10-12T11:36:08.123Z',
    previewPath: 'library_02/legacy-path-2026-10-12T11-36-08-123Z',
    files: [],
  };
  const item = {
    id: record.id,
    basePath: 'library_02',
    previewPath: record.previewPath,
    uploadedAt: Date.parse(record.uploadedAt),
    sourceFingerprint: previewSourceFingerprint(record),
  };
  assert.equal(
    validateFrozenRepairRecord('/repo', item, ['library_02'], () => [record]).previewPath,
    item.previewPath,
  );
  const mismatchedRecord = {
    ...record,
    previewPath: 'library_01/' + record.id,
  };
  assert.throws(
    () => validateFrozenRepairRecord('/repo', {
      ...item,
      previewPath: mismatchedRecord.previewPath,
    }, ['library_02'], () => [mismatchedRecord]),
    /shard changed or unsafe/i,
  );
});

test('legacy archive entries derive a stable timestamp from the ID when uploadedAt is absent', () => {
  const record = {
    id: 's200016-2026-07-27T09-53-02-926Z',
    uploadedAt: '',
    previewPath: 'library_01/s200016-2026-07-27T09-53-02-926Z',
    files: [],
  };
  const expected = Date.parse('2026-07-27T09:53:02.926Z');
  assert.equal(repairRecordTimestamp(record), expected);
  const item = {
    id: record.id,
    basePath: 'library_01',
    previewPath: record.previewPath,
    uploadedAt: expected,
    sourceFingerprint: previewSourceFingerprint(record),
  };
  assert.equal(
    validateFrozenRepairRecord('/repo', item, ['library_01'], () => [record]).at,
    expected,
  );
});

test('publish-time source guard rejects works hidden after inventory', () => {
  for (const visibility of [{ hiddenFromPublicLibrary: true }, { testOnly: true }]) {
    const record = {
      id: 'test-work',
      uploadedAt: '2026-11-19T00:00:00.000Z',
      previewPath: 'library_01/test-work',
      files: ['source.skel'],
      ...visibility,
    };
    const item = {
      id: record.id,
      basePath: 'library_01',
      previewPath: record.previewPath,
      uploadedAt: Date.parse(record.uploadedAt),
      sourceFingerprint: previewSourceFingerprint(record),
    };
    assert.throws(
      () => validateFrozenRepairRecord('/repo', item, ['library_01'], () => [record]),
      /not public/i,
    );
  }
});

test('matrix render job names do not expose per-work identifiers', () => {
  const workflow = readFileSync(new URL('../.github/workflows/repair-archive-card-previews.yml', import.meta.url), 'utf8');
  const start = workflow.indexOf('  render:');
  const end = workflow.indexOf('  publish:', start);
  assert.ok(start >= 0 && end > start, 'render job must exist');
  const render = workflow.slice(start, end);
  assert.ok(render.includes('    name: Render archive preview batch\n'), 'matrix job name must be a fixed, anonymous label');
  assert.doesNotMatch(render, /name:.*matrix\.batch/);
  assert.ok(workflow.includes("group: ${{ github.event_name == 'pull_request' && 'spine-archive-card-preview-repair-pr' || 'spine-archive-card-preview-repair' }}"), 'PR checks must not queue behind the main repair run');
});

test('live media verifier excludes hidden works and never logs work identifiers', () => {
  const verifier = readFileSync(new URL('./verify-ready-preview-live.mjs', import.meta.url), 'utf8');
  assert.match(verifier, /hiddenFromPublicLibrary !== true/);
  assert.match(verifier, /testOnly !== true/);
  assert.match(verifier, /Invalid production media URL in public entry/);
  assert.match(verifier, /return \{ok:true,ext:t\.ext,bytes:data\.length\}/);
  assert.match(verifier, /return \{ok:false,ext:t\.ext,error:last\}/);
  assert.match(verifier, /PRODUCTION_MEDIA_EVIDENCE '\+JSON\.stringify\(\{ok:result\.ok,ext:result\.ext/);
  assert.doesNotMatch(verifier, /id:t\.id|entry\.id\}\);|JSON\.stringify\(result\)/);
});

test('Spine export workflow serializes matrix arrays and imports repository modules from an absolute file URL', () => {
  const workflow = readFileSync(new URL('../.github/workflows/spine-export-all.yml', import.meta.url), 'utf8');
  assert.match(workflow, /echo '\$\{\{ toJSON\(matrix\.batch\) \}\}' > batch\.json/);
  assert.doesNotMatch(workflow, /echo '\$\{\{ matrix\.batch \}\}' > batch\.json/);
  assert.match(
    workflow,
    /const repoRoot = process\.cwd\(\);[\s\S]*?await import\(pathToFileURL\(path\.resolve\(repoRoot, 'scripts\/resolve-library\.mjs'\)\)\.href\)/,
  );
  assert.doesNotMatch(workflow, /await import\('\.\/scripts\/resolve-library\.mjs'\)/);
});
