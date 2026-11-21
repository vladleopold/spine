import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  hasSpineSourceBundle,
  normalizeSpineExportEntry,
  resolveSpineExportDispatch,
  missingAnimationPreviewMetadata,
  shouldPreserveAcceptedPreview,
  mergeSpineExportPreviewState,
} from './lib/spine-export-entry.mjs';

const sourceBundle = {
  id: 'upload-test',
  previewPath: 'library/upload-test',
  skeleton: 'hero.skel',
  atlas: 'hero.atlas',
  textures: ['hero.png'],
  files: ['hero.skel', 'hero.atlas', 'hero.png'],
};

assert.equal(hasSpineSourceBundle(sourceBundle), true);

const missing = normalizeSpineExportEntry({
  ...sourceBundle,
  animations: ['walk', 'idle'],
});
assert.equal(missing.error, null);
assert.equal(missing.entry.defaultAnimation, undefined,
  'available tracks must never become an implicit default');
assert.deepEqual(missing.entry.animations, ['walk', 'idle']);
assert.deepEqual(resolveSpineExportDispatch(missing.entry), {
  status: 'blocked',
  reason: 'missing-default-animation',
});
assert.deepEqual(missingAnimationPreviewMetadata(missing.entry), {
  webmStatus: 'blocked-missing-animation-selection',
  previewStatus: 'blocked',
  dispatchStatus: 'blocked',
  webmError: 'missing-default-animation',
  previewError: 'missing-default-animation',
});

const explicitDefault = normalizeSpineExportEntry({
  ...sourceBundle,
  animations: ['walk', 'idle'],
  defaultAnimation: 'idle',
});
assert.equal(explicitDefault.error, null);
assert.equal(explicitDefault.entry.defaultAnimation, 'idle');
assert.deepEqual(explicitDefault.entry.animations, ['walk', 'idle']);
assert.deepEqual(resolveSpineExportDispatch(explicitDefault.entry), {
  status: 'ready',
  animation: 'idle',
  animations: ['walk', 'idle'],
});

const unavailableDefault = normalizeSpineExportEntry({
  ...sourceBundle,
  animations: ['walk', 'idle'],
  defaultAnimation: 'Missing',
});
assert.equal(unavailableDefault.error, null);
assert.equal(unavailableDefault.entry.defaultAnimation, 'Missing');
assert.deepEqual(unavailableDefault.entry.animations, ['walk', 'idle'],
  'an unavailable selected name must not be inserted into or replaced by the source list');
assert.deepEqual(resolveSpineExportDispatch(unavailableDefault.entry), {
  status: 'ready',
  animation: 'Missing',
  animations: ['walk', 'idle'],
}, 'the exact unavailable name must reach the renderer unchanged');

const exactWhitespace = normalizeSpineExportEntry({
  ...sourceBundle,
  animations: ['walk'],
  defaultAnimation: ' walk ',
});
assert.equal(exactWhitespace.error, null);
assert.equal(exactWhitespace.entry.defaultAnimation, ' walk ',
  'the selected string must be preserved exactly, not silently trimmed');
assert.deepEqual(exactWhitespace.entry.animations, ['walk']);
assert.equal(resolveSpineExportDispatch(exactWhitespace.entry).status, 'ready');

const whitespaceOnly = normalizeSpineExportEntry({
  ...sourceBundle,
  animations: ['walk'],
  defaultAnimation: '   ',
});
assert.equal(whitespaceOnly.error, null);
assert.equal(whitespaceOnly.entry.defaultAnimation, '   ');
assert.equal(resolveSpineExportDispatch(whitespaceOnly.entry).status, 'blocked');

const invalidType = normalizeSpineExportEntry({
  ...sourceBundle,
  defaultAnimation: 42,
});
assert.equal(invalidType.error, 'DEFAULT_ANIMATION_INVALID');

const accepted = {
  ...sourceBundle,
  animations: ['walk', 'idle'],
  defaultAnimation: 'idle',
  webmStatus: 'ready',
  previewStatus: 'ready',
  dispatchStatus: 'ready',
  webmPreview: 'https://example.invalid/preview.webm',
  webpPoster: 'https://example.invalid/preview.webp',
  allAnimationPreviews: { walk: { webmPreview: 'walk.webm' } },
};
assert.equal(shouldPreserveAcceptedPreview(accepted, { ...accepted }), true);
assert.equal(shouldPreserveAcceptedPreview(accepted, {
  ...accepted,
  defaultAnimation: 'walk',
}), false, 'changing the selected animation invalidates the top-level ready preview');
assert.equal(shouldPreserveAcceptedPreview(accepted, {
  ...accepted,
  atlas: 'other.atlas',
}), false, 'changing the source bundle invalidates the top-level ready preview');
assert.equal(shouldPreserveAcceptedPreview(accepted, {
  ...accepted,
  previewStatus: 'blocked',
}), false, 'blocked media cannot be preserved as ready');

const preserved = mergeSpineExportPreviewState({ ...accepted, webmPreview: '' }, accepted);
assert.equal(preserved.preserveAcceptedPreview, true);
assert.equal(preserved.shouldDispatch, false);
assert.equal(preserved.entry.webmPreview, accepted.webmPreview,
  'an unchanged accepted source and selection keep the real preview URL');

const changedSelection = mergeSpineExportPreviewState({
  ...accepted,
  defaultAnimation: 'walk',
}, accepted);
assert.equal(changedSelection.preserveAcceptedPreview, false);
assert.equal(changedSelection.shouldDispatch, true);
assert.equal(changedSelection.entry.webmStatus, 'pending');
assert.equal(changedSelection.entry.previewStatus, 'pending');
assert.equal(changedSelection.entry.webmPreview, undefined,
  'do not leak the previous animation video while the new exact selection renders');
assert.deepEqual(changedSelection.entry.allAnimationPreviews, accepted.allAnimationPreviews,
  'per-animation media records for other explicitly named animations remain intact');

const missingState = mergeSpineExportPreviewState({
  ...sourceBundle,
  animations: ['walk', 'idle'],
}, accepted);
assert.equal(missingState.shouldDispatch, false);
assert.equal(missingState.entry.webmStatus, 'blocked-missing-animation-selection');
assert.equal(missingState.entry.previewStatus, 'blocked');
assert.equal(missingState.entry.webmPreview, undefined);

const explicitMissingList = mergeSpineExportPreviewState({
  ...sourceBundle,
  animations: ['walk'],
  defaultAnimation: 'Missing',
}, null);
assert.equal(explicitMissingList.shouldDispatch, true,
  'an explicit name absent from the advertised list must be sent to the renderer, not replaced');

const generic = { id: 'generic', files: ['poster.webp'] };
assert.deepEqual(normalizeSpineExportEntry(generic), { entry: generic, error: null });

const apiSource = fs.readFileSync(new URL('../api/github-upload.js', import.meta.url), 'utf8');
const renderWorkSource = fs.readFileSync(new URL('./render-work.mjs', import.meta.url), 'utf8');
const exporterSource = fs.readFileSync(new URL('./spine-export-webm.mjs', import.meta.url), 'utf8');
assert.match(apiSource, /resolveSpineExportDispatch\(entry\)/);
assert.match(apiSource, /const defaultAnimation = selection\.animation/);
assert.match(apiSource, /mergeSpineExportPreviewState\(entry, existingEntry\)/);
assert.doesNotMatch(apiSource, /entry\?\.animations\s*\[\s*0\s*\]/,
  'the upload API must not dispatch the first available track as a fallback');
assert.doesNotMatch(apiSource, /existingEntry\?\.webmStatus === 'ready' \? \{ webmStatus: 'ready' \}/,
  'a changed animation must not inherit the previous ready status');
assert.match(renderWorkSource, /await markPreviewBlocked\(selection\.animation/,
  'failed or missing selected animations must be persisted as blocked');
assert.match(renderWorkSource, /Object\.assign\(record,blocked\)/,
  'blocked status updates must preserve all source and index fields');
assert.match(renderWorkSource, /previewStatus:'ready'/,
  'a successful retry of the same exact animation must clear the previous blocked state');
assert.doesNotMatch(exporterSource, /alternatePreviewAnimations|targetAnimation\s*=\s*candidate/,
  'the renderer must never substitute another animation');

console.log('Upload animation selection is explicit, immutable, and fail-closed');
