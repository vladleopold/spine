import assert from 'node:assert/strict';
import { normalizeSpineExportEntry } from './lib/spine-export-entry.mjs';

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

const animationListWithoutSelection = normalizeSpineExportEntry({
  ...sourceBundle,
  animations: ['walk', 'idle'],
});
assert.equal(animationListWithoutSelection.error, 'DEFAULT_ANIMATION_REQUIRED',
  'a source animation list is not permission to choose its first animation');
assert.equal(animationListWithoutSelection.entry, null);

const explicitDefault = normalizeSpineExportEntry({
  ...sourceBundle,
  animations: ['walk', 'idle'],
  defaultAnimation: 'idle',
});
assert.equal(explicitDefault.error, null);
assert.equal(explicitDefault.entry.defaultAnimation, 'idle');

const unavailableExplicitDefault = normalizeSpineExportEntry({
  ...sourceBundle,
  animations: ['walk', 'idle'],
  defaultAnimation: 'not-in-source-list',
});
assert.equal(unavailableExplicitDefault.error, null);
assert.equal(unavailableExplicitDefault.entry.defaultAnimation, 'not-in-source-list');
assert.deepEqual(unavailableExplicitDefault.entry.animations, ['walk', 'idle'],
  'preserve an explicit name without injecting it into the source animation list');

const defaultOnly = normalizeSpineExportEntry({
  ...sourceBundle,
  defaultAnimation: 'idle',
});
assert.equal(defaultOnly.error, null);
assert.deepEqual(defaultOnly.entry.animations, [], 'do not synthesize a runtime animation list from the selected name');

const generic = { id: 'generic', files: ['poster.webp'] };
assert.deepEqual(normalizeSpineExportEntry(generic), { entry: generic, error: null });

console.log('Upload default-animation validation passed');
