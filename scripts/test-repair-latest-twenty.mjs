#!/usr/bin/env node
// Pure fixture test: no network, proprietary sources, ffmpeg or content uploads.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {previewSourceFingerprint} from './lib/repair-manifest-guard.mjs';
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
  const blockedRecord=records[19];
  blockedRecord.webmStatus='blocked-invisible-default-skin';
  blockedRecord.previewBlockedAnimation=blockedRecord.defaultAnimation;
  blockedRecord.previewBlockedSourceFingerprint=previewSourceFingerprint(blockedRecord);
  blockedRecord.previewBlockedSkin='';
  records[20].defaultAnimation=' Walk ';
  records[4].webmStatus='ready';
  records[4].previewStatus='failed';
  records[4].webmPreview='https://example.test/preview.webm';
  records[4].webpPoster='https://example.test/preview.webp';
  records[4].previewFrameCount=12;
  records[4].previewDuration=2;
  records.push({id:'synthetic-hidden',uploadedAt:'2026-11-19T06:00:00Z',
    previewPath:'library_02/synthetic-hidden',testOnly:true,hiddenFromPublicLibrary:true,
    files:['test.skel','test.atlas','test.png']});
  // Add older entries so the same fixture proves the configurable 50-item window
  // without changing which records belong to the default newest-20 window.
  for(let i=0;i<36;i++){
    const id='older-fixture-'+String(i).padStart(2,'0');
    records.push({id,uploadedAt:new Date(Date.UTC(2026,10,16,0,i,0)).toISOString(),
      previewPath:'library_02/'+id,webmStatus:'failed',defaultAnimation:'idle',
      files:['test.skel','test.atlas','test.png']});
  }
  fs.writeFileSync(path.join(shard,'index.json'),JSON.stringify(records));
  const result=spawnSync(process.execPath,[script,'matrix'],{
    cwd:root,encoding:'utf8',env:{...process.env,SPINE_REPAIR_INDEX_ONLY:'1',
      SPINE_REPAIR_SKIP_LIVE:'1',SPINE_REPAIR_LIMIT:'20'}});
  assert.equal(result.status,0,result.stderr);
  const output=Object.fromEntries(result.stdout.split('\n').filter(x=>x.includes('='))
    .map(x=>[x.slice(0,x.indexOf('=')),x.slice(x.indexOf('=')+1)]));
  const all=JSON.parse(output.allEntries);
  const matrix=JSON.parse(output.matrix);
  assert.equal(all.length,20);
  assert.equal(matrix.length,16);
  assert.equal(Number(output.renderCount),16);
  assert.ok(all.every(x=>x.id!=='synthetic-hidden'));
  assert.equal(all[0].id,'Spine-animation-2026-11-17T18-44-12-762Z');
  assert.equal(all[1].id,'Spine-animation-2026-11-17T18-45-14-132Z');
  assert.equal(all[19].id,'fixture-04');
  assert.equal(all[19].needsRender,true,'a failed preview status must force rerender even when old WebM metadata exists');
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
  assert.ok(all.slice(3).filter(x=>x.id!=='fixture-19').every(x=>x.ready&&x.needsRender));
  const blocked=all.find(x=>x.id==='fixture-19');
  assert.equal(blocked.ready,false);
  assert.equal(blocked.needsRender,false);
  assert.equal(blocked.blockedReason,'INVISIBLE_DEFAULT_SKIN');
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

  const fiftyResult=spawnSync(process.execPath,[script,'matrix'],{
    cwd:root,encoding:'utf8',env:{...process.env,SPINE_REPAIR_INDEX_ONLY:'1',
      SPINE_REPAIR_SKIP_LIVE:'1',SPINE_REPAIR_LIMIT:'50'}});
  assert.equal(fiftyResult.status,0,fiftyResult.stderr);
  const fiftyOutput=Object.fromEntries(fiftyResult.stdout.split('\n').filter(x=>x.includes('='))
    .map(x=>[x.slice(0,x.indexOf('=')),x.slice(x.indexOf('=')+1)]));
  const allFifty=JSON.parse(fiftyOutput.allEntries);
  const matrixFifty=JSON.parse(fiftyOutput.matrix);
  assert.equal(allFifty.length,50,'the requested 50 newest public works must be inventoried');
  assert.equal(matrixFifty.length,46,'only 46 entries with exact animation, complete source and no prior invisible-skin block may render');
  assert.equal(Number(fiftyOutput.renderCount),46);
  assert.ok(allFifty.slice(24).every(x=>x.ready&&x.needsRender),
    'the additional 26 older-but-in-window fixtures must remain eligible');
  assert.ok(allFifty.some(x=>x.id==='Spine-animation-2026-11-17T18-44-12-762Z'&&x.blockedReason==='MISSING_DEFAULT_ANIMATION'));
  assert.ok(allFifty.some(x=>x.id==='Spine-animation-2026-11-17T18-45-14-132Z'&&x.blockedReason==='MISSING_DEFAULT_ANIMATION'));
  assert.ok(allFifty.some(x=>x.id==='fixture-19'&&x.blockedReason==='INVISIBLE_DEFAULT_SKIN'&&!x.needsRender));
  assert.ok(allFifty.every(x=>/^[a-f0-9]{64}$/.test(x.sourceFingerprint)));
  const verifySource=fs.readFileSync(path.join(path.dirname(script),'verify-latest-twenty-live.mjs'),'utf8');
  const maskSource=fs.readFileSync(path.join(path.dirname(script),'mask-preview-manifest.mjs'),'utf8');
  assert.match(verifySource,/blocked-invisible-default-skin/);
  assert.match(verifySource,/blocked-static-animation/);
  assert.match(verifySource,/REPAIR_IDS_FILE/);
  assert.match(maskSource,/REPAIR_IDS_FILE/);
  console.log('PASS latest20: exact public selection, frozen source, blocked triad, no fake media');
}finally{fs.rmSync(root,{recursive:true,force:true});}
