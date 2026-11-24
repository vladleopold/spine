import assert from 'node:assert/strict';
import fs from 'node:fs';

const renderWork=fs.readFileSync(new URL('./render-work.mjs',import.meta.url),'utf8');
const classifier=fs.readFileSync(new URL('./renderer-failure-class.mjs',import.meta.url),'utf8');
const blockedStart=renderWork.indexOf('async function markBlockedRender(');
const blockedEnd=renderWork.indexOf('async function markBlockedSelection()',blockedStart);
assert.ok(blockedStart>=0&&blockedEnd>blockedStart,'per-upload renderer must have a guarded blocked-state publisher');
const blocked=renderWork.slice(blockedStart,blockedEnd);
assert.match(blocked,/record\.webmStatus=status/);
assert.match(blocked,/record\.previewStatus='blocked'/);
assert.match(blocked,/previewBlockedAnimation/);
assert.match(blocked,/previewBlockedSourceFingerprint/);
assert.match(blocked,/previewBlockedSkin/);
assert.match(renderWork,/renderer-failure-class\.mjs/);
assert.match(renderWork,/blocked-static-animation/);
assert.match(renderWork,/blocked-invisible-default-skin/);
assert.match(renderWork,/blocked-invalid-default-animation/);
assert.match(renderWork,/blocked-incomplete-source/);
assert.match(renderWork,/blocked-unsupported-runtime/);
assert.match(renderWork,/SPINE_PREVIEW_BLOCKED=NO_DEFAULT_SPINE_ANIMATION/);
assert.match(renderWork,/process\.exit\(0\)/,'expected blocked states must not become retrying workflow failures');
assert.match(renderWork,/SPINE_PREVIEW_BLOCKED=NO_DEFAULT_SPINE_ANIMATION[\s\S]*?process\.exit\(0\)/,
  'an indexed work with no selected animation is a successfully recorded blocked state, not a failed CI job');
assert.match(renderWork,/STALE_RENDER_SUPERSEDED/);
assert.match(renderWork,/report\.status='superseded'[\s\S]*?process\.exit\(0\)/,
  'a render superseded by a newer source/selection commit must exit cleanly without overwriting newer metadata');
assert.match(renderWork,/async function dispatchFullExport\(payload\)/,
  'full-export dispatch must use one bounded retry path');
assert.match(renderWork,/FULL_EXPORT_DISPATCH_RETRY=/,
  'transient GitHub dispatch failures must be retried with backoff');
assert.match(renderWork,/\[408,422,429,500,502,503,504\]/,
  'rate-limit, spam-protection and transient server responses must be retried');
assert.match(renderWork,/X-GitHub-Api-Version/,
  'repository dispatch must use an explicit GitHub API version');
assert.match(renderWork,/FULL_EXPORT_DISPATCH_HTTP_/,
  'a rejected follow-up dispatch must retain its HTTP status in the failure code');
assert.match(renderWork,/report\.status==='ready'[\s\S]*?report\.status='partial'[\s\S]*?report\.renderStatus='ready'/,
  'a follow-up dispatch failure must not misreport already-published media as a render failure');
assert.match(renderWork,/selection\.animation==='__SPINE_AUTO__'[\s\S]*?allow-visible-track-fallback/,
  'binary-only skeleton preview must opt into runtime-discovered visible-track selection');
assert.match(classifier,/COMPOSITED_FRAMES_IDENTICAL/);
assert.match(classifier,/COMPOSITED_FRAMES_NOT_VISIBLE/);
assert.match(classifier,/reason==="ANIMATION_SELECTION"\?"ANIMATION_SELECTION"/);
assert.ok(renderWork.includes("const gameCamera=parseGameCamera(config.gameCamera)"),
  'per-upload render config must parse an explicit game camera');
assert.ok(renderWork.includes("flags.push(`--game-camera=${gameCamera.width}x${gameCamera.height}`)"),
  'the parsed game camera must reach the actual WebM renderer');
console.log('PASS per-upload renderer records static and invisible default selections as blocked');
