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

const firstAnimationDefault = normalizeSpineExportEntry({
  ...sourceBundle,
  animations: ['walk', 'idle'],
});
assert.equal(firstAnimationDefault.error, null);
assert.equal(firstAnimationDefault.entry.defaultAnimation, 'walk');
assert.deepEqual(firstAnimationDefault.entry.animations, ['walk', 'idle']);

const explicitDefault = normalizeSpineExportEntry({
  ...sourceBundle,
  animations: ['walk', 'idle'],
  defaultAnimation: 'idle',
});
assert.equal(explicitDefault.error, null);
assert.equal(explicitDefault.entry.defaultAnimation, 'idle');

const defaultOnly = normalizeSpineExportEntry({
  ...sourceBundle,
  defaultAnimation: 'idle',
});
assert.equal(defaultOnly.error, null);
assert.deepEqual(defaultOnly.entry.animations, ['idle']);

const generic = { id: 'generic', files: ['poster.webp'] };
assert.deepEqual(normalizeSpineExportEntry(generic), { entry: generic, error: null });

console.log('Upload default-animation validation passed');
