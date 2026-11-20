import { createHash } from 'node:crypto';
import path from 'node:path';
import { previewSourceFingerprint } from '../repair-manifest-guard.mjs';

export const SOURCE_PRESERVATION_CASES = Object.freeze([
  Object.freeze({
    sourceFingerprint: '6ca8132962330977fb358902f0b54527208b37f7f8c24f81c6f3c00b880b8364',
    animationIndex: 7,
    animationFingerprint: 'f3d9e163c12a6c05f8b0cf6078777858121620a43c1a0e3896f3aaab068689aa',
  }),
  Object.freeze({
    sourceFingerprint: '9c8d7fdcd918395bdaa2fdf09c8057c1fc9e1648165d3059eab27b93d7711b86',
    animationIndex: 0,
    animationFingerprint: '053be2367ba1dc9d601a8fcb818fa63381688204562cb52950442666f0771219',
  }),
]);

export function animationFingerprint(animation) {
  return createHash('sha256').update(String(animation)).digest('hex');
}

function blocked(code) {
  return { status: 'blocked', code };
}

export function resolveSourcePreservationCase(entries, caseIndex, cases = SOURCE_PRESERVATION_CASES) {
  const rawIndex = String(caseIndex ?? '');
  if (!/^(0|[1-9][0-9]*)$/.test(rawIndex)) return blocked('invalid-case-index');
  const index = Number(rawIndex);
  if (!Number.isSafeInteger(index) || !Array.isArray(entries)) return blocked('invalid-case-input');
  const spec = cases[index];
  if (!spec) return blocked('case-not-configured');

  const matches = entries.filter((entry) =>
    previewSourceFingerprint(entry) === spec.sourceFingerprint);
  if (matches.length !== 1) return blocked('source-fingerprint-missing-or-ambiguous');

  const entry = matches[0];
  if (entry.hiddenFromPublicLibrary === true || entry.testOnly === true) {
    return blocked('source-not-public');
  }
  if (!Array.isArray(entry.animations)) return blocked('animation-list-missing');

  const animation = entry.animations[spec.animationIndex];
  if (typeof animation !== 'string' || !animation.trim()) {
    return blocked('exact-animation-missing');
  }
  if (animationFingerprint(animation) !== spec.animationFingerprint) {
    return blocked('exact-animation-mismatch');
  }
  if (entry.defaultAnimation !== animation) {
    return blocked('default-animation-changed');
  }
  if (typeof entry.skeleton !== 'string' || !entry.skeleton.trim() ||
      typeof entry.atlas !== 'string' || !entry.atlas.trim() ||
      !Array.isArray(entry.textures) || entry.textures.length === 0) {
    return blocked('source-bundle-incomplete');
  }

  const sourceDir = String(entry.previewPath || '').trim();
  const expectedDir = 'library_02/' + String(entry.id || '');
  if (!sourceDir || sourceDir !== expectedDir ||
      path.posix.normalize(sourceDir) !== sourceDir ||
      sourceDir.startsWith('/') || sourceDir.split('/').includes('..')) {
    return blocked('source-path-invalid');
  }

  return { status: 'ready', caseIndex: index, entry, animation, sourceDir };
}
