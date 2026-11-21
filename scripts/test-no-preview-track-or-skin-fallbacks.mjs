import assert from 'node:assert/strict';
import fs from 'node:fs';

const read = (relative) => fs.readFileSync(new URL(relative, import.meta.url), 'utf8');
const preview = read('../api/github-preview.js');
const batch = read('./batch-export-all.mjs');
const science = read('../lib/spine-data-science.js');
const app = read('../src/SpineApp.tsx');

assert.match(preview,
  /const defaultAnimation = typeof entry\?\.defaultAnimation === 'string' \? entry\.defaultAnimation : '';/,
  'preview sets must use only the exact indexed default animation');
assert.match(preview,
  /const active = activeAnimation\.name && names\.includes\(activeAnimation\.name\) \? activeAnimation\.name : '';/,
  'viewport refit must stop when the exact active animation is unavailable');
assert.match(preview,
  /const animation = activeAnimation\.name \? skeleton\.data\.findAnimation\(activeAnimation\.name\) : null;/,
  'bounds measurement must never substitute the first runtime animation');
assert.match(preview,
  /function preferredSkinName\(skinNames\) \{\s*return Array\.isArray\(skinNames\) && skinNames\.includes\('default'\) \? 'default' : '';\s*\}/,
  'preview API may select only the source default skin');
assert.doesNotMatch(preview, /animations\s*\[\s*0\s*\]|names\s*\[\s*0\s*\]|skinNames\s*\[\s*0\s*\]|includes\('idle'\)/,
  'preview API must not infer an animation or skin from list order or idle naming');

assert.match(preview, /const matchedTextures = atlasPages\.map/,
  'atlas pages must be paired with exact source texture names');
assert.match(preview, /textures\.length === 1 && atlasPages\.length === 1/,
  'a sole texture may be used only for a sole atlas page');
assert.match(preview, /if \(atlasPages\.length === 0 \|\| matchedTextures\.some\(\(texture\) => !texture\)\) continue;/,
  'missing or ambiguous atlas textures must block the set');
assert.doesNotMatch(preview, /data:image\/png;base64,/,
  'missing atlas pages must never be disguised by a synthetic 1x1 texture');

assert.match(batch,
  /const targetAnim = typeof entry\.defaultAnimation === 'string' \? entry\.defaultAnimation : '';/,
  'batch duration calculation must use the exact indexed default');
assert.match(batch,
  /const animName = typeof entry\.defaultAnimation === 'string' \? entry\.defaultAnimation : '';/,
  'batch export must use the exact indexed default');
assert.doesNotMatch(batch, /entry\.animations\s*\[\s*0\s*\]/,
  'batch export must not choose the first track');

assert.match(science,
  /defaultAnimation: typeof entry\?\.defaultAnimation === 'string' \? entry\.defaultAnimation : '',/,
  'data-science metadata must preserve only the explicit indexed default');
assert.doesNotMatch(science, /animations\s*\[\s*0\s*\]/,
  'data-science metadata must not invent a default animation');

assert.match(app,
  /function preferredSkinName\(skinNames: string\[\]\) \{\s*return Array\.isArray\(skinNames\) && skinNames\.includes\("default"\) \? "default" : "";\s*\}/,
  'the player may select only the source default skin');
assert.match(app,
  /const nextActiveAnimation = typeof nextSpine\.defaultAnimation === "string" \? nextSpine\.defaultAnimation : "";/,
  'extra players must retain the exact indexed default, including unavailable names');
assert.match(app,
  /const animationName = activeAnimationRef\.current \|\| preparedSpineRef\.current\?\.defaultAnimation \|\| "";/,
  'manual playback must not choose the first animation');
assert.match(app, /const defaultAnimation = "";/,
  'fresh source bundles must wait for a user-selected animation');
assert.match(app, /return preparedSets\\.length === 1 \\? preparedSets\\[0\\] : null;/,
  'multiple skeleton sets must require an explicit set selection');
assert.match(app, /The indexed skeleton file is missing; refusing to preview a different set\\./,
  'editable pages must not switch to another skeleton set when the indexed one is missing');
assert.match(app, /const playableAnimation = initialAnimation && names\\.includes\\(initialAnimation\\) &&/,
  'runtime playback must validate and play only the exact selected animation');
assert.doesNotMatch(app, /animationNames\\.find\\([^\\n]*idle|animationNames\\s*\\[\\s*0\\s*\\]|preparedSets\\s*\\[\\s*0\\s*\\]|names\\s*\\[\\s*0\\s*\\]|names\\.find\\([^\\n]*playAnimationWithLoopMode|label\\.includes\\(\"clover\"\\)/i,
  'the UI must not choose idle, the first track, the first set, or a cross-work set');

assert.doesNotMatch(app,
  /animationsRef\.current\s*\[\s*0\s*\]|nextAnimations\s*\[\s*0\s*\]|skinNames\s*\[\s*0\s*\]|nextSpine\.defaultAnimation\s*\|\|\s*"animation"/,
  'the UI must not invent a first-track or synthetic animation name');

console.log('PASS preview, batch export, data-science metadata and UI preserve exact animation/default skin without list-order fallbacks');
