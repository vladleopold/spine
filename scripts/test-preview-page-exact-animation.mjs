import assert from 'node:assert/strict';
import fs from 'node:fs';
import { selectExactAnimation, selectExactPreview } from '../lib/exact-animation-selection.mjs';

const runtimeNames = ['Idle', 'Run', 'Mask'];
assert.equal(selectExactAnimation(runtimeNames, 'Run').status, 'ready');
assert.equal(selectExactAnimation(runtimeNames, 'Run').animation, 'Run');
assert.equal(selectExactAnimation(runtimeNames, 'Missing').status, 'blocked');
assert.equal(selectExactAnimation(runtimeNames, 'Missing').name, 'Missing');
assert.equal(selectExactAnimation(runtimeNames, 'Missing').animation, null);
assert.equal(selectExactAnimation(runtimeNames, '').status, 'blocked');
assert.equal(selectExactAnimation([{ name: 'Walk' }], 'Walk').status, 'ready');

const entry = {
  defaultAnimation: 'Run',
  allAnimationPreviews: {
    Idle: { webmPreview: 'idle.webm', webpPoster: 'idle.webp', previewDuration: 3 },
    Run: { webmPreview: 'run.webm', webpPoster: 'run.webp', previewDuration: 0.5 },
  },
};
assert.equal(selectExactPreview(entry).status, 'ready');
assert.equal(selectExactPreview(entry).name, 'Run');
assert.equal(selectExactPreview(entry).preview.webmPreview, 'run.webm');
assert.equal(selectExactPreview(entry, 'Idle').preview.webmPreview, 'idle.webm');
assert.equal(selectExactPreview(entry, 'Missing').status, 'blocked');
assert.equal(selectExactPreview(entry, 'Missing').name, 'Missing');
assert.equal(selectExactPreview(entry, 'Missing').preview, null);
assert.equal(selectExactPreview({ ...entry, defaultAnimation: '' }).status, 'blocked');

const api = fs.readFileSync(new URL('../api/github-preview.js', import.meta.url), 'utf8');
assert.match(api, /selectExactAnimation/);
assert.match(api, /selectExactPreview/);
assert.doesNotMatch(api, /(?:skeleton\.data\.)?animations\s*\[\s*0\s*\]/,
  'the preview route must not choose the first animation');
assert.doesNotMatch(api, /filteredNames\s*\[\s*0\s*\]|names\s*\[\s*0\s*\]/,
  'player startup and viewport recovery must not select the first track');
assert.doesNotMatch(api, /findAnimation\(activeAnimation\.name\)\s*\|\|/,
  'bounds measurement must not measure a different animation');
assert.doesNotMatch(api, /candidates\.find|for\s*\(const\s+a\s+of\s+animations\)/,
  'video metadata must not walk alternate preview tracks');
assert.doesNotMatch(api, /target\.url\s*\|\|\s*repairEntryAssetUrl\(entry,\s*entry\?\.webmPreview/,
  'work-page video metadata must not fall back to a work-level clip');
assert.match(api, /return queryAnimation \|\|/,
  'an unavailable URL-selected animation must remain selected and become blocked');
assert.match(api, /preview-selection-blocked/,
  'unavailable exact selections must be visibly marked blocked');
console.log('PASS work-page preview preserves exact selected/default animation without fallback');
