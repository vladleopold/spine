import assert from 'node:assert/strict';
import fs from 'node:fs';
import { resolveIndexedPreviewSet } from './lib/preview-set-selection.mjs';

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
assert.doesNotMatch(preview, /animations\s*\[\s*0\s*\]|names\s*\[\s*0\s*\]|filteredNames\s*\[\s*0\s*\]|skinNames\s*\[\s*0\s*\]|includes\('idle'\)/,
  'preview API must not infer an animation or skin from list order or idle naming');

assert.match(preview, /const matchedTextures = atlasPages\.map/,
  'atlas pages must be paired with exact source texture names');
assert.match(preview, /textures\.length === 1 && atlasPages\.length === 1/,
  'a sole texture may be used only for a sole atlas page');
assert.match(preview, /if \(atlasPages\.length === 0 \|\| matchedTextures\.some\(\(texture\) => !texture\)\) continue;/,
  'missing or ambiguous atlas textures must block the set');
assert.doesNotMatch(preview, /data:image\/png;base64,/,
  'missing atlas pages must never be disguised by a synthetic 1x1 texture');

const previewTargetStart = preview.indexOf('function resolvePreviewTarget(entry, origin = \'\', requestedAnimation = \'\') {');
const previewTargetEnd = preview.indexOf('// Compact download picker for the sidebar.', previewTargetStart);
assert.ok(previewTargetStart >= 0 && previewTargetEnd > previewTargetStart,
  'the exact preview target resolver must exist');
const previewTarget = preview.slice(previewTargetStart, previewTargetEnd);
assert.match(previewTarget, /const selected = chosen \? pick\(chosen\) : null;/,
  'the work page may resolve only the exact indexed default animation');
assert.match(previewTarget, /isFallback: false/,
  'the resolver must never report or produce a substitute animation');
assert.doesNotMatch(previewTarget, /for \(const a of animations\)|candidates\.find|fallback \|\| first|target\.name !== chosen/,
  'a short or missing selected preview must not fall through to another animation');

assert.match(preview, /const contentUrl = entryVideoAsset\(target\.url, entry, 'webm'\);/,
  'video metadata must use only the selected animation URL');
assert.match(preview, /const poster = entryImageAsset\(target\.poster, entry, 'poster'\);/,
  'video metadata must use only the selected animation poster');
assert.match(preview, /const lowWebm = entryVideoAsset\(target\.lowUrl \|\| target\.url, item, 'webm'\);/,
  'owner-library low rendition must remain within the selected animation');
assert.match(preview, /webmPreviewFull: entryVideoAsset\(target\.url, item, 'webm'\)/,
  'owner-library full video must remain within the selected animation');
assert.match(preview, /thumbnailPoster: entryImageAsset\(target\.poster, item, 'poster'\)/,
  'owner-library poster must remain within the selected animation');
assert.doesNotMatch(preview, /target\.url\s*\|\|\s*repairEntryAssetUrl\(entry, entry\?\.webmPreview|target\.url\s*\|\|\s*repairEntryAssetUrl\(item, item\?\.webmPreview|target\.poster\s*\|\|\s*item\?\.thumbnailPoster/,
  'a missing selected preview must not borrow a generic or alternate animation asset');

const fallbackPageStart = preview.indexOf('function createVideoFallbackHtml(');
const fallbackPageEnd = preview.indexOf('async function createDynamicPreview(', fallbackPageStart);
assert.ok(fallbackPageStart >= 0 && fallbackPageEnd > fallbackPageStart,
  'the no-set fallback page must exist');
const fallbackPage = preview.slice(fallbackPageStart, fallbackPageEnd);
assert.match(fallbackPage, /const poster = videoSeo\?\.thumbnailUrl \|\| '';/,
  'the fallback page must use only a verified selected-animation poster');
assert.match(fallbackPage, /const video = videoSeo\?\.contentUrl \|\| '';/,
  'the fallback page must use only the exact selected-animation video URL');
assert.doesNotMatch(fallbackPage, /entry\?\.webmPreview/,
  'the fallback page must not borrow a work-level WebM from another animation');
const ownerWorksStart = preview.indexOf('const authorWorks = (Array.isArray(ownerProfile?.library)');
const ownerWorksEnd = preview.indexOf('.filter((item) => item.video || item.poster);', ownerWorksStart);
assert.ok(ownerWorksStart >= 0 && ownerWorksEnd > ownerWorksStart,
  'the owner-library media mapper must exist');
const ownerWorks = preview.slice(ownerWorksStart, ownerWorksEnd);
assert.match(ownerWorks, /const target = resolvePreviewTarget\(item, origin\);/,
  'each owner-library card must resolve its own exact indexed default animation');
assert.match(ownerWorks, /poster: entryImageAsset\(target\.poster, item, 'poster'\)/,
  'owner-library posters must come from that exact animation');
assert.match(ownerWorks, /video: entryVideoAsset\(target\.lowUrl \|\| target\.url, item, 'webm'\)/,
  'owner-library videos must come from that exact animation');
assert.doesNotMatch(ownerWorks, /item\?\.webmPreview|item\?\.thumbnailPoster|item\?\.thumbnail/,
  'owner-library cards must not use generic work-level media fields');
assert.doesNotMatch(fallbackPage, /generatedThumbnailUrl|entry\?\.thumbnailPoster/,
  'the fallback page must not disguise missing selected media with a generic poster');

const selectionStart = preview.indexOf('function initialSet()');
const selectionEnd = preview.indexOf('// Kept in sync with the server-side PREVIEW_PAD', selectionStart);
assert.ok(selectionStart >= 0 && selectionEnd > selectionStart,
  'URL selection functions must exist');
const selectionCode = preview.slice(selectionStart, selectionEnd);
assert.match(selectionCode, /const indexedSet = sets\.find\(\(set\) => set\.label === config\.activeLabel\)/,
  'the work page must resolve the set identified by the source index');
assert.match(selectionCode, /if \(indexedSet\) return indexedSet;/,
  'the exact indexed skeleton set must win over animation-name matches');
assert.match(selectionCode, /if \(config\.requireIndexedSet\) return null;/,
  'a missing indexed skeleton set must not fall through to another set');
assert.match(selectionCode, /return matches\.length === 1 \? matches\[0\] : null;/,
  'a non-indexed animation may identify a set only when the match is unique');
assert.match(selectionCode, /return sets\.length === 1 \? sets\[0\] : null;/,
  'only a sole set may be selected implicitly');
assert.match(selectionCode, /return queryAnimation \|\| set\?\.animation \|\| "";/,
  'the exact URL animation name must be preserved even when it is not in the list');

const indexedSets = [
  {
    label: 'unrelated',
    skeleton: 'https://spine-link.vercel.app/assets/library_02/other/other.json',
    atlasUrl: 'https://spine-link.vercel.app/assets/library_02/other/other.atlas?v=1',
    animation: '',
  },
  {
    label: 'indexed',
    skeleton: 'https://spine-link.vercel.app/assets/library_02/target/target.skel',
    atlasUrl: 'https://spine-link.vercel.app/assets/library_02/target/target.atlas?v=2',
    animation: '',
  },
];
const exactIndexedSelection = resolveIndexedPreviewSet(indexedSets, {
  skeleton: 'target.skel',
  atlas: 'target.atlas',
  defaultAnimation: 'Missing exact track',
});
assert.equal(exactIndexedSelection?.set, indexedSets[1],
  'the index must bind the preview to its exact skeleton and atlas');
assert.equal(exactIndexedSelection.animation, 'Missing exact track',
  'an unavailable indexed animation name must remain exact');
const noIndexedDefault = resolveIndexedPreviewSet(indexedSets, {
  skeleton: 'target.skel',
  atlas: 'target.atlas',
});
assert.equal(noIndexedDefault?.set, indexedSets[1]);
assert.equal(noIndexedDefault.animation, '',
  'an absent default remains unselected rather than becoming the first track');
assert.equal(resolveIndexedPreviewSet([
  indexedSets[1],
  { ...indexedSets[1], label: 'duplicate' },
], { skeleton: 'target.skel', atlas: 'target.atlas', defaultAnimation: 'Exact' }), null,
  'ambiguous source-set matches must fail closed');
assert.equal(resolveIndexedPreviewSet(indexedSets, {
  skeleton: 'missing.skel',
  atlas: 'missing.atlas',
  defaultAnimation: 'Exact',
}), null, 'a missing indexed source set must not borrow another set');
assert.equal(resolveIndexedPreviewSet(indexedSets, { defaultAnimation: 'Exact' }), null,
  'animation metadata alone must not identify an unrelated skeleton set');
assert.match(preview, /indexedSelection = resolveIndexedPreviewSet\(sets, entry\)/,
  'the dynamic preview must bind the source index to its exact set');
assert.match(preview, /activeLabel: indexedSelection\?\.set\?\.label \|\| ''/,
  'the browser must start from the indexed set when it is unambiguous');
assert.match(preview, /requireIndexedSet: Boolean\(entry\?\.skeleton \|\| entry\?\.atlas\)/,
  'a missing indexed set must prevent single-set fallback');

const scenarioStart = preview.indexOf('function syncScenario() {}');
const scenarioEnd = preview.indexOf('function markPreviewBlocked(', scenarioStart);
assert.ok(scenarioStart >= 0 && scenarioEnd > scenarioStart,
  'automatic track sequencing must be disabled');
assert.doesNotMatch(preview.slice(scenarioStart, scenarioEnd), /scenarioState|lookup\.has|idle|loop|playNextScenarioStep/,
  'in/idle/out and loop tracks must never be chained automatically');

const playbackStart = preview.indexOf('function setPreviewStatus(status, message, preserveSameAnimationVideo = false)');
const playbackEnd = preview.indexOf('function togglePlayback()', playbackStart);
assert.ok(playbackStart >= 0 && playbackEnd > playbackStart,
  'blocked-state and exact playback guards must exist');
const playbackCode = preview.slice(playbackStart, playbackEnd);
assert.match(playbackCode, /setPreviewStatus\("blocked", "Selected animation is unavailable; no alternate animation was played\."/,
  'an unavailable selected animation must be visibly marked blocked');
assert.match(playbackCode, /const exactAnimation = player\?\.skeleton\?\.data\?\.findAnimation\?\.\(name\);/,
  'playback must resolve the exact requested animation from the loaded skeleton');
assert.match(playbackCode, /if \(!exactAnimation\) \{\s*const box = document\.getElementById\("player"\);\s*markPreviewBlocked\(Boolean\(box\?\.querySelector\("\.preview-fallback-video"\)\)\);\s*return;\s*\}/,
  'a missing animation must stop and may retain only its exact same-animation WebM');
assert.doesNotMatch(playbackCode, /playNextScenarioStep|scenarioStep/,
  'playback completion must not switch to an auxiliary track');
assert.match(playbackCode, /function markPreviewNeedsSelection\(\)/,
  'a missing default waits for explicit user selection rather than choosing a track');
assert.match(playbackCode, /box\.dataset\.previewStatus = status/,
  'blocked and awaiting-selection states must be exposed on the player');
assert.match(playbackCode, /overlay\.textContent = message/,
  'the player must explain why an animation is blocked');
assert.doesNotMatch(playbackCode, /player\?\.dispose|player = null/,
  'blocking an animation must not destroy the player needed for an explicit manual selection');
assert.match(playbackCode, /try \{\s*const entry = player\.setAnimation\(name, loopEnabled\.value\);/,
  'the exact selected animation must be set inside a guarded runtime call');
assert.match(playbackCode, /catch \(error\) \{\s*markPreviewBlocked\(\);/,
  'a failed exact-animation call must become blocked');
assert.match(playbackCode, /if \(!player\) \{ void createPlayer\(\); return; \}/,
  'manual selection can retry the player without choosing a different animation');

const playerStart = preview.indexOf('async function createPlayer()');
const playerEnd = preview.indexOf('function renderAnimationList()', playerStart);
assert.ok(playerStart >= 0 && playerEnd > playerStart,
  'player startup must exist');
const playerCode = preview.slice(playerStart, playerEnd);
assert.match(playerCode, /if \(!activeSet\.value\) \{ markPreviewBlocked\(\); return; \}/,
  'a missing selected set must be blocked');
assert.match(playerCode, /if \(!activeAnimation\.name\) \{\s*markPreviewNeedsSelection\(\);\s*return;/,
  'an empty selection must remain unselected');
assert.match(playerCode, /if \(!filteredNames\.includes\(activeAnimation\.name\)\) \{\s*const box = document\.getElementById\("player"\);\s*markPreviewBlocked\(Boolean\(box\?\.querySelector\("\.preview-fallback-video"\)\)\);\s*return;/,
  'player startup must block an absent selected animation and retain only its exact same-animation video');
assert.doesNotMatch(playerCode, /filteredNames\s*\[\s*0\s*\]|activeSet\.value\?\.animation\s*&&\s*filteredNames/,
  'player startup must not choose the first runtime track or replace the requested name');
assert.match(playerCode, /const fallback = box\?\.querySelector\("\.preview-fallback-video"\) \|\| showPreviewVideoFallback\(\);/,
  'runtime failure may retain only the already-gated same-animation WebM');
assert.match(playerCode, /if \(fallback\) \{\s*fallback\.controls = true;\s*return;/,
  'the exact same-animation WebM remains available when Spine runtime cannot initialize');

const videoFallbackStart = preview.indexOf('function showPreviewVideoFallback()');
const videoFallbackEnd = preview.indexOf('function clearPreviewVideoFallback()', videoFallbackStart);
assert.ok(videoFallbackStart >= 0 && videoFallbackEnd > videoFallbackStart,
  'same-animation video fallback helper must exist');
assert.match(preview.slice(videoFallbackStart, videoFallbackEnd), /videoAnimation !== activeAnimation\.name/,
  'the temporary WebM may be shown only when its indexed animation matches the exact selection');

const videoMetadataStart = preview.indexOf('function videoMetadataForEntry(');
const videoMetadataEnd = preview.indexOf('function breadcrumbStructuredData(', videoMetadataStart);
assert.ok(videoMetadataStart >= 0 && videoMetadataEnd > videoMetadataStart,
  'video metadata resolver must exist');
const videoMetadata = preview.slice(videoMetadataStart, videoMetadataEnd);
assert.match(videoMetadata, /resolvePreviewTarget\(entry, origin, requestedAnimation\)/,
  'the video panel must resolve the URL-selected animation');
assert.match(videoMetadata, /animation: target\.name/,
  'video metadata must carry the exact animation identity');

assert.match(preview, /async function createDynamicPreview\(settings, uploadPath, origin, requestedAnimation = ''\)/,
  'dynamic preview must accept the URL-selected animation');
assert.match(preview, /videoMetadataForEntry\(origin, entry, entryId, note, canonicalUrl, playerUrl, requestedAnimation\)/,
  'dynamic preview must pass the selected animation to video metadata');
assert.match(preview, /createDynamicPreview\(settings, path, origin, requestedAnimation\)/,
  'the request handler must pass the exact query selection through to the page');
assert.match(preview, /const legacyDefault = Boolean\(chosen && chosen === indexedDefault && !previews\);/,
  'legacy single-preview fields may be used only for the exact indexed default');
assert.doesNotMatch(preview, /setSelect\.onchange = \(\) => \{ activeSet\.value = sets\.find\(\(set\) => set\.label === setSelect\.value\) \|\| sets\[0\]/,
  'an invalid set selection must not switch to the first set');

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
assert.match(app, /return preparedSets\.length === 1 \? preparedSets\[0\] : null;/,
  'multiple skeleton sets must require an explicit set selection');
assert.match(app, /The indexed skeleton file is missing; refusing to preview a different set\./,
  'editable pages must not switch to another skeleton set when the indexed one is missing');
assert.match(app, /const playableAnimation = initialAnimation && names\.includes\(initialAnimation\) &&/,
  'runtime playback must validate and play only the exact selected animation');
assert.doesNotMatch(app, /animationNames\.find\([^\n]*idle|animationNames\s*\[\s*0\s*\]|names\s*\[\s*0\s*\]|names\.find\([^\n]*playAnimationWithLoopMode|label\.includes\("clover"\)/i,
  'the UI must not choose idle, the first track, the first set, or a cross-work set');

assert.doesNotMatch(app,
  /animationsRef\.current\s*\[\s*0\s*\]|nextAnimations\s*\[\s*0\s*\]|skinNames\s*\[\s*0\s*\]|nextSpine\.defaultAnimation\s*\|\|\s*"animation"/,
  'the UI must not invent a first-track or synthetic animation name');

console.log('PASS preview, batch export, data-science metadata and UI preserve exact animation/default skin without list-order fallbacks');
