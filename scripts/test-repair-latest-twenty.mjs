#!/usr/bin/env node
// Pure fixture test: no network, proprietary sources, ffmpeg or content uploads.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
const script=fileURLToPath(new URL('./repair-latest-twenty-previews.mjs',import.meta.url));
const repairSource=fs.readFileSync(script,'utf8');
const liveVerifier=fs.readFileSync(fileURLToPath(new URL('./verify-latest-twenty-live.mjs',import.meta.url)),'utf8');
const workflow=fs.readFileSync(fileURLToPath(new URL('../.github/workflows/repair-latest-twenty-previews.yml',import.meta.url)),'utf8');
assert.ok(repairSource.includes('for(const suffix of ["","-medium","-low"])'),
  'all three WebM tiers must be decoded before existing media is accepted');
assert.ok(repairSource.includes('verify-preview-motion.mjs'),
  'each existing quality tier must have eight distinct visible frames');
assert.ok(repairSource.includes('const selected=record.allAnimationPreviews?.[record.defaultAnimation]'),
  'existing media must be associated with the exact indexed default animation');
assert.ok(repairSource.includes('selected.webmPreviewMedium!==record.webmPreviewMedium'));
assert.ok(liveVerifier.includes('const selected=record.allAnimationPreviews?.[work.animation]'));
assert.ok(liveVerifier.includes('selected.webpPosterLow!==record.webpPosterLow'));
assert.ok(repairSource.includes('record?.previewStatus!=="ready"'),
  'stale or failed preview metadata must be repaired, not accepted');
assert.ok(repairSource.includes('"/api/github-upload.js"'));
assert.ok(repairSource.includes('"/.github/workflows/repair-latest-twenty-previews.yml"'));
assert.ok(repairSource.includes('"/api/github-upload.js"'));
assert.ok(repairSource.includes('verifyPosterFirstFrame(video,poster)'),
  'each stored WebP must match frame zero of its paired WebM');
assert.ok(liveVerifier.includes('verify-preview-motion.mjs'));
assert.ok(liveVerifier.includes('verifyPosterFirstFrame'));
assert.ok(liveVerifier.includes('response.arrayBuffer()'),
  'production verification must download full media bodies, not a range prefix');
assert.ok(!liveVerifier.includes("Range:'bytes=0-16383'"),
  'a 16 KiB signature probe is not a decoded-media verification');
assert.ok(liveVerifier.includes("record.previewStatus!=='ready'"));
assert.ok(liveVerifier.includes('record.defaultAnimation!==work.animation'));
assert.ok(liveVerifier.includes('frames>=8'));
assert.ok(liveVerifier.includes('contentType'));
assert.ok(workflow.includes('sparse-checkout: ${{ steps.latest.outputs.sparseCheckout }}'),
  'the full source bundle checkout must use the frozen manifest paths');
assert.ok(workflow.includes('matrix: ${{ steps.verified.outputs.matrix }}'),
  'render decisions must come from the decoded-media verification pass');
const verifiedStep=workflow.slice(workflow.indexOf('id: verified'),workflow.indexOf('\n  render:'));
assert.ok(verifiedStep.includes('id: verified'));
assert.ok(!verifiedStep.includes('SPINE_REPAIR_INDEX_ONLY'),
  'the second pass must not trust index-only preview metadata');
assert.ok(verifiedStep.includes('node scripts/repair-latest-twenty-previews.mjs matrix'));
assert.ok(workflow.includes('Decode 20 actual public WebM/WebP pairs after publication'));
assert.ok(workflow.includes('/scripts/verify-preview-motion.mjs'));
assert.ok(workflow.includes('/scripts/lib/first-frame-poster.mjs'));
assert.ok(!liveVerifier.includes('console.log(JSON.stringify(work))'),
  'production evidence must not log private source records');
assert.ok(!liveVerifier.includes('work.id'),
  'production logs must never print work identifiers');
assert.ok(!repairSource.includes('record.defaultAnimation=animation'),
  'publishing a preview must never rewrite the source index default animation');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'spine-latest20-'));
try{
  const shard=path.join(root,'library_02');fs.mkdirSync(shard,{recursive:true});
  const records=Array.from({length:24},(_,i)=>{
    const id='fixture-'+String(i).padStart(2,'0');
    const date=new Date(Date.UTC(2026,10,17,0,i,0)).toISOString();
    return {id,uploadedAt:date,previewPath:'library_02/'+id,
      webmStatus:'failed',defaultAnimation:i===22?undefined:'idle',
      files:['test.skel','test.atlas','test.png']};
  });
  // These historical records previously received hard-coded animation
  // names when defaultAnimation was absent. They must now remain blocked.
  records[23].id='Spine-animation-2026-11-17T18-44-12-762Z';
  records[23].previewPath='library_02/'+records[23].id;
  records[23].defaultAnimation=undefined;
  records[22].id='Spine-animation-2026-11-17T18-45-14-132Z';
  records[22].previewPath='library_02/'+records[22].id;
  records[22].defaultAnimation=undefined;
  records[21].files=['test.skel'];
  records.push({id:'synthetic-hidden',uploadedAt:'2026-11-19T06:00:00Z',
    previewPath:'library_02/synthetic-hidden',testOnly:true,hiddenFromPublicLibrary:true,
    files:['test.skel','test.atlas','test.png']});
  fs.writeFileSync(path.join(shard,'index.json'),JSON.stringify(records));
  const result=spawnSync(process.execPath,[script,'matrix'],{
    cwd:root,encoding:'utf8',env:{...process.env,SPINE_REPAIR_INDEX_ONLY:'1',
      SPINE_REPAIR_SKIP_LIVE:'1'}});
  assert.equal(result.status,0,result.stderr);
  const output=Object.fromEntries(result.stdout.split('\n').filter(x=>x.includes('='))
    .map(x=>[x.slice(0,x.indexOf('=')),x.slice(x.indexOf('=')+1)]));
  const all=JSON.parse(output.allEntries);
  const matrix=JSON.parse(output.matrix);
  assert.equal(all.length,20);
  assert.equal(matrix.length,17);
  assert.equal(Number(output.renderCount),17);
  assert.ok(all.every(x=>x.id!=='synthetic-hidden'));
  assert.equal(all[0].id,'Spine-animation-2026-11-17T18-44-12-762Z');
  assert.equal(all[1].id,'Spine-animation-2026-11-17T18-45-14-132Z');
  assert.equal(all[19].id,'fixture-04');
  for(const id of [
    'Spine-animation-2026-11-17T18-44-12-762Z',
    'Spine-animation-2026-11-17T18-45-14-132Z',
  ]){
    const item=all.find(x=>x.id===id);
    assert.ok(item);
    assert.equal(item.animation,'','missing default must not be filled from a historical name');
    assert.equal(item.ready,false);
    assert.equal(item.needsRender,false);
    assert.equal(item.blockedReason,'MISSING_DEFAULT_ANIMATION');
    assert.ok(!matrix.some(x=>x.id===id),'a record without a selected animation must never enter render matrix');
  }
  assert.equal(all[2].ready,false);
  assert.equal(all[2].needsRender,false);
  assert.equal(all[2].blockedReason,'MISSING_SOURCE_TRIAD');
  assert.ok(all.slice(3).every(x=>x.ready&&x.needsRender&&x.animation==='idle'));
  assert.doesNotMatch(repairSource,/indexedAnimation\s*\|\|\s*\(/,
    'no hard-coded animation name may replace a missing default');
  assert.match(repairSource,/blocked-missing-animation-selection/);
  const missingSelectionBranch=repairSource.match(
    /if\(!item\.animation && !\(typeof record\.defaultAnimation==="string"&&record\.defaultAnimation\.trim\(\)\)\)\{([\s\S]*?)\n\s*\}/
  )?.[1]||"";
  assert.match(missingSelectionBranch,/record\.webmStatus="blocked-missing-animation-selection"/,
    "missing exact selection must remain blocked even if a previous WebM exists");
  assert.match(missingSelectionBranch,/record\.previewStatus="blocked"/);
  assert.doesNotMatch(missingSelectionBranch,/existingMediaOk|refreshStoredPostersAndTimestamp/,
    "unattributed old media cannot be reaccepted or used to regenerate a poster");
  assert.ok(all.every(x=>/^[a-f0-9]{64}$/.test(x.sourceFingerprint)));
  console.log('PASS latest20: exact public selection, frozen source, blocked triad, no fake media');
}finally{fs.rmSync(root,{recursive:true,force:true});}
