import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  normalizeSpineExportEntry,
  resolveSpineExportDispatch,
} from './lib/spine-export-entry.mjs';

const sourceBundle = {
  id: 'upload-test',
  skeleton: 'hero.skel',
  atlas: 'hero.atlas',
  textures: ['hero.png'],
  files: ['hero.skel', 'hero.atlas', 'hero.png'],
};

const missing = normalizeSpineExportEntry(sourceBundle);
assert.equal(missing.error, 'DEFAULT_ANIMATION_REQUIRED');
assert.equal(missing.entry, null);

const missingWithAvailableTracks = normalizeSpineExportEntry({
  ...sourceBundle,
  animations: ['walk', 'idle'],
});
assert.equal(missingWithAvailableTracks.error, 'DEFAULT_ANIMATION_REQUIRED');
assert.equal(missingWithAvailableTracks.entry, null,
  'available tracks must never become an implicit default');

assert.deepEqual(resolveSpineExportDispatch({
  ...sourceBundle,
  animations: ['walk', 'idle'],
}), {
  status: 'blocked',
  reason: 'missing-default-animation',
});

const explicitDefault = normalizeSpineExportEntry({
  ...sourceBundle,
  animations: ['walk', 'idle'],
  defaultAnimation: 'idle',
});
assert.equal(explicitDefault.error, null);
assert.equal(explicitDefault.entry.defaultAnimation, 'idle');
assert.deepEqual(explicitDefault.entry.animations, ['walk', 'idle']);

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
});

const exactWhitespace = normalizeSpineExportEntry({
  ...sourceBundle,
  animations: ['walk'],
  defaultAnimation: ' walk ',
});
assert.equal(exactWhitespace.error, null);
assert.equal(exactWhitespace.entry.defaultAnimation, ' walk ',
  'the selected string must be preserved exactly, not silently trimmed');
assert.deepEqual(exactWhitespace.entry.animations, ['walk']);

const defaultOnly = normalizeSpineExportEntry({
  ...sourceBundle,
  defaultAnimation: 'idle',
});
assert.equal(defaultOnly.error, null);
assert.equal(defaultOnly.entry.defaultAnimation, 'idle');
assert.equal(defaultOnly.entry.animations, undefined,
  'do not fabricate an animation list when only the exact default is known');

const generic = { id: 'generic', files: ['poster.webp'] };
assert.deepEqual(normalizeSpineExportEntry(generic), { entry: generic, error: null });

const apiSource = fs.readFileSync(new URL('../api/github-upload.js', import.meta.url), 'utf8');
assert.match(apiSource, /resolveSpineExportDispatch\(entry\)/);
assert.match(apiSource, /const defaultAnimation = selection\.animation/);
assert.doesNotMatch(apiSource, /entry\?\.animations\s*\[0\]/,
  'the upload API must not dispatch the first available track as a fallback');

console.log('Upload animation selection is explicit, immutable, and fail-closed');
