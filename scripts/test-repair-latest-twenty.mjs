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
  records[23].files=['test.skel'];
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
  assert.equal(matrix.length,18);
  assert.equal(Number(output.renderCount),18);
  assert.ok(all.every(x=>x.id!=='synthetic-hidden'));
  assert.equal(all[0].id,'fixture-23');
  assert.equal(all[19].id,'fixture-04');
  assert.equal(all[0].ready,false);
  assert.equal(all[0].needsRender,false);
  assert.equal(all[1].ready,false);
  assert.equal(all[1].needsRender,false);
  assert.equal(all[1].blockedReason,'MISSING_DEFAULT_ANIMATION');
  assert.ok(all.slice(2).every(x=>x.ready&&x.needsRender&&x.animation==='idle'));
  assert.match(repairSource,/blocked-missing-animation-selection/);
  assert.ok(all.every(x=>/^[a-f0-9]{64}$/.test(x.sourceFingerprint)));
  console.log('PASS latest20: exact public selection, frozen source, blocked triad, no fake media');
}finally{fs.rmSync(root,{recursive:true,force:true});}
