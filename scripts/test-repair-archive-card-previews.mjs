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
