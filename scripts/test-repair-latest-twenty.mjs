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
assert.ok(!repairSource.includes('record.defaultAnimation=animation'),
  'publishing a preview must never rewrite the source index default animation');
assert.ok(!repairSource.includes('record.animations=meta.animations'),
  'publishing a preview must never rewrite source animation names');
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
  records[20].defaultAnimation=' Walk ';
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
  const matrix=JSON.parse(output.matrix);
  const renderSlots=JSON.parse(output.renderSlots);
  assert.ok(matrix.every(item=>Number.isInteger(item.repairSlot)&&Object.keys(item).every(key=>key==="repairSlot"||key==="needsRender")),
    "render matrix must expose only opaque numeric slots");
  const envPath=path.join(root,"prepared-manifest.env");
  const prepare=spawnSync(process.execPath,[script,"prepare-manifest"],{
    cwd:root,encoding:"utf8",
    env:{...process.env,SPINE_REPAIR_INDEX_ONLY:"1",SPINE_REPAIR_SKIP_LIVE:"1",
      GITHUB_ENV:envPath,EXPECTED_MANIFEST_SHA256:output.manifestSha256,
      RENDER_SLOTS_JSON:output.renderSlots}
  });
  assert.equal(prepare.status,0,prepare.stderr);
  const envText=fs.readFileSync(envPath,"utf8");
  const manifestMatch=envText.match(/^REPAIR_IDS_JSON<<([^\n]+)\n([\s\S]*?)\n\1$/m);
  assert.ok(manifestMatch,"masked manifest must be transported through GITHUB_ENV, not a step/job env expression");
  const all=JSON.parse(manifestMatch[2]);
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
  assert.ok(all.slice(3).every(x=>x.ready&&x.needsRender));
  assert.equal(all[3].animation,' Walk ','the exact index animation string must pass through unchanged');
  assert.ok(all.slice(4).every(x=>x.animation==='idle'));
  assert.doesNotMatch(repairSource,/record\.defaultAnimation\.trim\(\)/,
    'selection presence must not normalize the exact animation name');
  assert.match(repairSource,/choosePreviewAnimation\(\[\],record\?\.defaultAnimation\)/);
  assert.doesNotMatch(repairSource,/indexedAnimation\s*\|\|\s*\(/,
    'no hard-coded animation name may replace a missing default');
  assert.match(repairSource,/blocked-missing-animation-selection/);
  const missingSelectionBranch=repairSource.match(
    /if\(!selectedAnimation\|\|selectedAnimation!==indexedAnimation\)\{([\s\S]*?)\n\s*\}/
  )?.[1]||"";
  assert.match(missingSelectionBranch,/record\.webmStatus="blocked-missing-animation-selection"/,
    "missing exact selection must remain blocked even if a previous WebM exists");
  assert.match(missingSelectionBranch,/record\.previewStatus="blocked"/);
  assert.doesNotMatch(missingSelectionBranch,/existingMediaOk|refreshStoredPostersAndTimestamp/,
    "unattributed old media cannot be reaccepted or used to regenerate a poster");
  assert.ok(all.every(x=>/^[a-f0-9]{64}$/.test(x.sourceFingerprint)));
  console.log('PASS latest20: exact public selection, frozen source, blocked triad, no fake media');
}finally{fs.rmSync(root,{recursive:true,force:true});}
