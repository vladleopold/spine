#!/usr/bin/env node
import assert from "node:assert/strict";
import fs from "node:fs";
import {
  hasWebmSignature,
  hasWebpSignature,
  isSameWorkMediaPair,
} from "./lib/reported-preview-media.mjs";
import {
  classifyPreviewHttpStatus,
  classifyReportedPreviewEntry,
  hasExactPreviewAnimation,
} from "./lib/reported-preview-live-status.mjs";

const webm=new Uint8Array(256);
webm.set([0x1a,0x45,0xdf,0xa3]);
const webp=new Uint8Array(256);
webp.set([0x52,0x49,0x46,0x46]);
webp.set([0x57,0x45,0x42,0x50],8);
assert.equal(hasWebmSignature(webm),true);
assert.equal(hasWebpSignature(webp),true);
assert.equal(hasWebmSignature(webm.subarray(0,255)),false);
assert.equal(hasWebpSignature(new Uint8Array(256)),false);

const root="https://spine-link.vercel.app/assets/library_02/work-a/";
for(const tier of ["","-medium","-low"]){
  assert.equal(isSameWorkMediaPair(root+"preview"+tier+".webm",root+"preview"+tier+".webp"),true);
}
assert.equal(isSameWorkMediaPair(root+"preview.webm",root+"preview-low.webp"),false);
assert.equal(isSameWorkMediaPair(root+"preview.webm",root.replace("work-a","work-b")+"preview.webp"),false);
assert.equal(isSameWorkMediaPair("https://raw.githubusercontent.com/vladleopold/spine/main/library_02/work-a/preview.webm",root+"preview.webp"),false);

assert.equal(classifyPreviewHttpStatus(200),"ok");
assert.equal(classifyPreviewHttpStatus(404),"failed");
for(const status of [0,401,402,403,408,425,429,500,503]){
  assert.equal(classifyPreviewHttpStatus(status),"blocked");
}
const exact={webmStatus:"ready",previewStatus:"ready",defaultAnimation:"walk",animations:["walk"],webmAnimation:"walk"};
assert.equal(hasExactPreviewAnimation(exact),true);
assert.equal(classifyReportedPreviewEntry(exact),"ready");
assert.equal(classifyReportedPreviewEntry({...exact,webmAnimation:"run"}),"failed");
assert.equal(classifyReportedPreviewEntry({...exact,webmAnimation:undefined}),"blocked");
assert.equal(classifyReportedPreviewEntry({...exact,previewStatus:"failed"}),"failed");

const read=path=>fs.readFileSync(new URL(path,import.meta.url),"utf8");
const verifier=read("./verify-reported-preview-live.mjs");
const verifyWorkflow=read("../.github/workflows/verify-reported-preview-live.yml");
const repairWorkflow=read("../.github/workflows/repair-reported-previews.yml");
const idsBlock=verifier.match(/const ids=\[([\s\S]*?)\];/);
assert.ok(idsBlock,"retain the explicit reported-work manifest");
assert.equal((idsBlock[1].match(/"/g)||[]).length/2,18,"keep all 18 reported works");
assert.match(verifier,/const priorityId=/,"audit the separately prioritized work");
assert.match(verifier,/verify-preview-motion\.mjs/,"decode and compare real moving frames");
assert.match(verifier,/verify-poster-first-frame\.mjs/,"verify every poster against its own video frame zero");
assert.match(verifier,/isSameWorkMediaPair/);
assert.match(verifier,/classifyPreviewHttpStatus/);
assert.match(verifier,/classifyReportedPreviewEntry/);
assert.match(verifier,/entry\.webmAnimation/);
assert.doesNotMatch(verifier,/alternatePreviewAnimations|targetAnimation\s*=\s*candidate/);
assert.match(verifier,/REPORTED_PREVIEW_PRODUCTION_AUDIT=/);
assert.doesNotMatch(verifier,/console\.log\([^\n]*(?:allIds|assetUrl|webmPreview)/,
  "never print private work identifiers or asset URLs in public action logs");

assert.match(verifyWorkflow,/schedule:\s*\n\s+- cron: '\\d+ \\* \\* \\* \\*'/);
assert.match(verifyWorkflow,/workflow_run:/);
assert.match(verifyWorkflow,/workflow_run\.event != 'pull_request'/);
assert.match(verifyWorkflow,/workflow_run\.conclusion == 'success'/);
assert.match(verifyWorkflow,/timeout-minutes: 25/);
assert.match(verifyWorkflow,/\/scripts\/verify-preview-motion\.mjs/);
assert.match(verifyWorkflow,/\/scripts\/verify-poster-first-frame\.mjs/);
assert.match(repairWorkflow,/test-repair-reported-previews\.mjs/);
assert.match(repairWorkflow,/test-reported-preview-live\.mjs/);
assert.match(repairWorkflow,/reported19-/);
assert.match(repairWorkflow,/verify-preview-motion\.mjs/);
assert.match(repairWorkflow,/verify-poster-first-frame\.mjs/);
assert.doesNotMatch(repairWorkflow,/^\s+verify-production:/m,
  "the scheduled verifier is the only live audit; do not run duplicate post-publish checks");
console.log("PASS reported preview audit: exact animation, all three media tiers, decode/motion, first-frame match, hourly schedule, privacy-safe logs");
