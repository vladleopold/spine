#!/usr/bin/env node
// Pure fixture test: no network, proprietary sources, ffmpeg or content uploads.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {spawnSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';
import {previewSourceFingerprint} from './repair-manifest-guard.mjs';
const script=fileURLToPath(new URL('./repair-latest-twenty-previews.mjs',import.meta.url));
const repairSource=fs.readFileSync(script,'utf8');
const workflowSource=fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)),'../.github/workflows/repair-latest-twenty-previews.yml'),'utf8');
assert.ok(!repairSource.includes('record.defaultAnimation=animation'),
  'publishing a preview must never rewrite the source index default animation');
const liveAudit=fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)),'verify-latest-twenty-live.mjs'),'utf8');
assert.match(liveAudit,/record\.previewBlockedAnimation===String\(work\.animation\|\|record\.defaultAnimation\|\|''\)/,
  'the production audit must compare blocked metadata to the frozen selected source track, not only the original default');
assert.ok(!repairSource.includes('record.animations=meta.animations'),
  'publishing a preview must never rewrite source animation names');
const root=fs.mkdtempSync(path.join(os.tmpdir(),'spine-latest20-'));
try{
  const shard=path.join(root,'library_02');fs.mkdirSync(shard,{recursive:true});
  const records=Array.from({length:24},(_,i)=>{
    const id='fixture-'+String(i).padStart(2,'0');
    const date=new Date(Date.UTC(2026,10,17,0,i,0)).toISOString();
    return {id,uploadedAt:date,previewPath:'library_02/'+id,
      webmStatus:'failed',defaultAnimation:i===22?undefined:'idle',animations:['Idle','Walk'],
      files:['test.json','test.atlas','test.png']};
  });
  // These historical records have no explicit default. Their source-declared
  // animation names are used only for preview rendering, never written back.
  records[23].id='Spine-animation-2026-11-17T18-44-12-762Z';
  records[23].previewPath='library_02/'+records[23].id;
  records[23].defaultAnimation=undefined;
  records[22].id='Spine-animation-2026-11-17T18-45-14-132Z';
  records[22].previewPath='library_02/'+records[22].id;
  records[22].defaultAnimation=undefined;
  // Legacy indexes may store only an ID; it is normalized to the collection path.
  records[4].previewPath=records[4].id;
  // Binary-only Spine 3.7 source: Player 3.7 requires a same-work JSON sibling.
  records[18].skeleton='hero.skel';
  records[18].atlas='hero.atlas';
  records[18].files=['hero.skel','hero.atlas','hero.png'];
  const versionString=value=>Buffer.concat([Buffer.from([value.length+1]),Buffer.from(value)]);
  const legacy37=Buffer.concat([versionString('legacy-hash'),versionString('3.7.93'),Buffer.alloc(32)]);
  const supportedBinary42=Buffer.concat([versionString('fixture-hash'),versionString('4.2.34'),Buffer.alloc(32)]);
  const legacyDirectory=path.join(root,'library_02','fixture-18');
  fs.mkdirSync(legacyDirectory,{recursive:true});
  fs.writeFileSync(path.join(legacyDirectory,'hero.skel'),legacy37);
  fs.writeFileSync(path.join(legacyDirectory,'hero.atlas'),'hero.png\nsize: 1,1\nformat: RGBA8888\n');
  fs.writeFileSync(path.join(legacyDirectory,'hero.png'),Buffer.alloc(24));
  records[21].files=['test.skel'];
  const blockedRecord=records[19];
  blockedRecord.webmStatus='blocked-invisible-default-skin';
  blockedRecord.previewBlockedAnimation=blockedRecord.defaultAnimation;
  blockedRecord.previewBlockedSourceFingerprint=previewSourceFingerprint(blockedRecord);
  blockedRecord.previewBlockedRendererRevision='visibility-contrast-v2';
  blockedRecord.previewBlockedSkin='';
  records[20].defaultAnimation=' Walk ';
  records[4].webmStatus='ready';
  records[4].previewStatus='failed';
  records[4].webmPreview='https://example.test/preview.webm';
  records[4].webpPoster='https://example.test/preview.webp';
  records[4].previewFrameCount=12;
  records[4].previewDuration=2;
  // A previously accepted preview whose status was metadata-blocked can be
  // restored without rerendering only when the exact selected track and media
  // set remain present; the production job additionally verifies bytes/motion.
  records[5].webmStatus='blocked-missing-animation-selection';
  records[5].previewStatus='blocked';
  records[5].previewAnimation='Idle';
  records[5].allAnimationPreviews={Idle:{webmPreview:'https://example.test/preview.webm'}};
  records[5].webmPreview='https://example.test/preview.webm';
  records[5].webpPoster='https://example.test/preview.webp';
  records[5].previewFrameCount=60;
  records[5].previewDuration=2;
  records.push({id:'synthetic-hidden',uploadedAt:'2026-11-19T06:00:00Z',
    previewPath:'library_02/synthetic-hidden',testOnly:true,hiddenFromPublicLibrary:true,
    files:['test.skel','test.atlas','test.png']});
  // Add older entries so the same fixture proves the configurable 50-item window
  // without changing which records belong to the default newest-20 window.
  for(let i=0;i<36;i++){
    const id='older-fixture-'+String(i).padStart(2,'0');
    records.push({id,uploadedAt:new Date(Date.UTC(2026,10,16,0,i,0)).toISOString(),
      previewPath:'library_02/'+id,webmStatus:'failed',
      ...(i===35?{}:{defaultAnimation:'idle'}),
      // Use a valid JSON skeleton for ordinary older fixtures. Keep only the
      // final record binary-only to exercise runtime-deferred animation choice.
      files:i===35?['test.skel','test.atlas','test.png']:['test.json','test.atlas','test.png']});
  }
  // Materialize source triads for every fixture. The production inventory
  // now inspects real files rather than trusting index.files alone.
  const pngHeader=Buffer.alloc(24);
  Buffer.from([137,80,78,71,13,10,26,10]).copy(pngHeader,0);
  pngHeader.writeUInt32BE(1,16);
  pngHeader.writeUInt32BE(1,20);
  for(const record of records){
    const directory=path.join(root,'library_02',record.id);
    fs.mkdirSync(directory,{recursive:true});
    const names=Array.isArray(record.files)?record.files:[];
    const skeleton=names.find(name=>/\.(json|skel)$/i.test(name));
    const atlas=names.find(name=>/\.atlas(?:\.txt|\.docx)?$/i.test(name));
    const texture=names.find(name=>/\.(png|jpe?g|webp|dds)$/i.test(name));
    if(skeleton){
      const target=path.join(directory,skeleton);
      if(!fs.existsSync(target)){
        if(/\.json$/i.test(skeleton)){
          fs.writeFileSync(target,JSON.stringify({skeleton:{spine:'4.2'},bones:[{name:'root'}],
            animations:{Idle:{bones:{root:{translate:[{time:0,x:0,y:0},{time:1,x:1,y:0}]}}}}}));
        }else fs.writeFileSync(target,supportedBinary42);
      }
    }
    if(atlas&&!fs.existsSync(path.join(directory,atlas))){
      fs.writeFileSync(path.join(directory,atlas),texture
        ?texture+'\nsize: 1,1\nformat: RGBA8888\nfilter: Linear,Linear\nrepeat: none\n'
        :'');
    }
    if(texture&&!fs.existsSync(path.join(directory,texture)))fs.writeFileSync(path.join(directory,texture),pngHeader);
  }
  fs.writeFileSync(path.join(shard,'index.json'),JSON.stringify(records));
  const result=spawnSync(process.execPath,[script,'matrix'],{
    cwd:root,encoding:'utf8',env:{...process.env,SPINE_REPAIR_INDEX_ONLY:'1',
      SPINE_REPAIR_SKIP_LIVE:'1',SPINE_REPAIR_LIMIT:'20',SPINE_REPAIR_OFFSET:'0'}});
  assert.equal(result.status,0,result.stderr);
  const output=Object.fromEntries(result.stdout.split('\n').filter(x=>x.includes('='))
    .map(x=>[x.slice(0,x.indexOf('=')),x.slice(x.indexOf('=')+1)]));
  const all=JSON.parse(fs.readFileSync(path.join(root,'repair-manifest.json'),'utf8'));
  const matrix=JSON.parse(output.matrix);
  assert.equal(all.length,20);
  if(matrix.length!==17)console.log('FIXTURE_MATRIX_DIAGNOSTICS='+JSON.stringify(all.map(x=>({id:x.id,ready:x.ready,needsRender:x.needsRender,blockedReason:x.blockedReason,animation:x.animation}))));
  assert.equal(matrix.length,17);
  assert.equal(Number(output.renderCount),17);
  assert.ok(all.every(x=>x.id!=='synthetic-hidden'));
  assert.equal(all[0].id,'Spine-animation-2026-11-17T18-44-12-762Z');
  assert.equal(all[1].id,'Spine-animation-2026-11-17T18-45-14-132Z');
  assert.equal(all[19].id,'fixture-04');
  assert.equal(all[19].previewPath,'library_02/fixture-04',
    'legacy ID-only previewPath values must be normalized to their source collection');
  assert.equal(all[19].needsRender,true,'a failed preview status must force rerender even when old WebM metadata exists');
  for(const id of [
    'Spine-animation-2026-11-17T18-44-12-762Z',
    'Spine-animation-2026-11-17T18-45-14-132Z',
  ]){
    const item=all.find(x=>x.id===id);
    assert.ok(item);
    assert.match(item.animation,/^idle$/i,'missing default should use the source-declared Idle track');
    assert.equal(item.ready,true);
    assert.equal(item.needsRender,true);
    assert.equal(item.blockedReason,'');
    assert.ok(matrix.some(x=>x.id===id),'source-declared animation fallback should enter render matrix');
  }
  assert.equal(all[2].ready,false);
  assert.equal(all[2].needsRender,false);
  assert.equal(all[2].blockedReason,'MISSING_SOURCE_TRIAD');
  const legacyBinary=all.find(x=>x.id==='fixture-18');
  assert.equal(legacyBinary.ready,false);
  assert.equal(legacyBinary.needsRender,false);
  assert.equal(legacyBinary.blockedReason,'UNSUPPORTED_SPINE_3_7_BINARY_SKELETON',
    'Spine 3.7 binary-only source without same-work JSON must not enter native rendering');
  assert.ok(all.slice(3).filter(x=>!['fixture-19','fixture-18','fixture-05'].includes(x.id)).every(x=>x.ready&&x.needsRender));
  const reusable=all.find(x=>x.id==='fixture-05');
  assert.equal(reusable.ready,true);
  assert.equal(reusable.needsRender,false,'previously accepted exact preview media should be restored after live verification rather than rerendered');
  assert.ok(!matrix.some(x=>x.id==='fixture-05'));
  const formerlyBlocked=all.find(x=>x.id==='fixture-19');
  assert.equal(formerlyBlocked.ready,true,'new renderer revision must retry previously blocked default skin');
  assert.equal(formerlyBlocked.needsRender,true);
  assert.equal(formerlyBlocked.blockedReason,'');
  assert.match(all[3].animation,/^idle$/i,'an unavailable indexed track falls back to a real source track');
  assert.ok(all.slice(4).every(x=>/^idle$/i.test(x.animation)));
  assert.doesNotMatch(repairSource,/record\.defaultAnimation\.trim\(\)/,
    'selection presence must not normalize the exact animation name');
  assert.match(repairSource,/readSourceAnimationNames\(e,record\)/);
  assert.doesNotMatch(repairSource,/indexedAnimation\s*\|\|\s*\(/,
    'no hard-coded animation name may replace a missing default');
  assert.match(repairSource,/blocked-missing-animation-selection/);
  assert.match(repairSource,/downloaded-latest50/);
assert.match(repairSource,/latest50-/);
assert.match(workflowSource,/animation:m\.animation/);
assert.match(workflowSource,/hasExistingAcceptedMedia[\s\S]*?item\.indexedWebmStatus==='ready'[\s\S]*?item\.indexedPreviewStatus==='ready'[\s\S]*?item\.ready!==true && !hasExistingAcceptedMedia/);
assert.match(repairSource,/rendererRevision:PREVIEW_RENDERER_REVISION[\s\S]*?itemRendererRevision=typeof item\.rendererRevision==="string"[\s\S]*?previewBlockedRendererRevision===itemRendererRevision[\s\S]*?previewBlockedRendererRevision=itemRendererRevision/,
    'the renderer revision must be frozen in the manifest so a newer publisher checkout cannot falsely mark an older render as current');
  assert.match(repairSource,/meta\.animationFallbackUsed===true/,
    'a preview may use another source-declared animation only after visible motion is verified');
  assert.match(repairSource,/record\.previewAnimation=animation/,
    'the exact rendered track is stored separately from the source default');
  assert.match(repairSource,/function existingPreviewAnimationName\(record\)[\s\S]*?current!=="__SPINE_AUTO__"[\s\S]*?item\?\.webmPreview===record\?\.webmPreview/,
    "an automatic-selection sentinel must not overwrite the exact animation identity of existing media");
  assert.match(repairSource,/if\(!sourceCheck\.complete\)[\s\S]*?record\.dispatchStatus==="rendered"[\s\S]*?existingMediaOk\(entryInfo\)[\s\S]*?await liveMediaOk\(entryInfo\)[\s\S]*?await originalMediaFilesOk\(entryInfo\)[\s\S]*?record\.webmStatus="ready"[\s\S]*?summary\.ready\+\+/,
    "previously accepted media can be restored after a source-only downgrade only when all six files pass local, live and repository verification");
  assert.match(repairSource,/PREVIEW_RENDERER_REVISION="auto-track-recovery-v9-frozen-renderer-revision"/);
  assert.match(workflowSource,/--allow-visible-track-fallback/);
  assert.match(workflowSource,/ALLOW_VISIBLE_TRACK_FALLBACK: "true"/);
  const missingSelectionBranch=repairSource.match(
    /if\(!selectedAnimation\)\{([\s\S]*?)\n\s*\}/
  )?.[1]||"";
  assert.match(missingSelectionBranch,/record\.webmStatus="blocked-missing-animation-selection"/,
    "a source with no discoverable animation must remain blocked");
  assert.match(missingSelectionBranch,/record\.previewStatus="blocked"/);
  assert.doesNotMatch(missingSelectionBranch,/existingMediaOk|refreshStoredPostersAndTimestamp/,
    "unattributed old media cannot be reaccepted or used to regenerate a poster");
  assert.ok(all.every(x=>/^[a-f0-9]{64}$/.test(x.sourceFingerprint)));

  const fiftyResult=spawnSync(process.execPath,[script,'matrix'],{
    cwd:root,encoding:'utf8',env:{...process.env,SPINE_REPAIR_INDEX_ONLY:'1',
      SPINE_REPAIR_SKIP_LIVE:'1',SPINE_REPAIR_LIMIT:'50',SPINE_REPAIR_OFFSET:'0'}});
  assert.equal(fiftyResult.status,0,fiftyResult.stderr);
  const fiftyOutput=Object.fromEntries(fiftyResult.stdout.split('\n').filter(x=>x.includes('='))
    .map(x=>[x.slice(0,x.indexOf('=')),x.slice(x.indexOf('=')+1)]));
  const allFifty=JSON.parse(fs.readFileSync(path.join(root,'repair-manifest.json'),'utf8'));
  const matrixFifty=JSON.parse(fiftyOutput.matrix);
  assert.equal(allFifty.length,50,'the requested 50 newest public works must be inventoried');
  assert.equal(matrixFifty.length,47,'incomplete and unsupported sources stay blocked; one verified reusable preview is not rerendered');
  assert.equal(Number(fiftyOutput.renderCount),47);
  assert.ok(allFifty.slice(24).every(x=>x.ready&&x.needsRender),
    'the additional 26 older-but-in-window fixtures must remain eligible');
  assert.ok(allFifty.some(x=>x.id==='Spine-animation-2026-11-17T18-44-12-762Z'&&/^idle$/i.test(x.animation)&&x.needsRender));
  assert.ok(allFifty.some(x=>x.id==='Spine-animation-2026-11-17T18-45-14-132Z'&&x.animation==='Idle'&&x.needsRender));
  assert.ok(allFifty.some(x=>x.id==='older-fixture-35'&&x.animation==='__SPINE_AUTO__'&&x.ready&&x.needsRender),
    'binary-only skeletons defer animation selection to the pinned Spine runtime');
  assert.ok(allFifty.some(x=>x.id==='fixture-19'&&x.ready&&x.needsRender));
  assert.ok(allFifty.every(x=>/^[a-f0-9]{64}$/.test(x.sourceFingerprint)));
  assert.equal(Number(fiftyOutput.totalCount),60,'the inventory must report the full public archive size');
  assert.equal(Number(fiftyOutput.nextOffset),50,'the first batch must expose the next archive offset');

  const olderResult=spawnSync(process.execPath,[script,'matrix'],{
    cwd:root,encoding:'utf8',env:{...process.env,SPINE_REPAIR_INDEX_ONLY:'1',
      SPINE_REPAIR_SKIP_LIVE:'1',SPINE_REPAIR_LIMIT:'10',SPINE_REPAIR_OFFSET:'50'}});
  assert.equal(olderResult.status,0,olderResult.stderr);
  const olderOutput=Object.fromEntries(olderResult.stdout.split('\n').filter(x=>x.includes('='))
    .map(x=>[x.slice(0,x.indexOf('=')),x.slice(x.indexOf('=')+1)]));
  const olderBatch=JSON.parse(fs.readFileSync(path.join(root,'repair-manifest.json'),'utf8'));
  assert.equal(olderBatch.length,10,'the final partial archive batch must be selectable');
  assert.equal(Number(olderOutput.offset),50);
  assert.equal(Number(olderOutput.totalCount),60);
  assert.equal(Number(olderOutput.nextOffset),60,'the final batch must stop exactly at the archive end');
  assert.notEqual(olderBatch[0].id,allFifty[0].id,'offset 50 must not repeat the newest batch');
  assert.ok(olderBatch.every(x=>x.id.startsWith('older-fixture-')),'the older batch must contain older public records');
  assert.match(workflowSource,/dispatch-next-batch/,'successful publication must queue the next archive batch');
  assert.doesNotMatch(workflowSource,/needs\.verify-production\.result == 'success'/,
    'partial live-audit failures must not prevent the next archive batch after verified-only publication');
  assert.match(workflowSource,/description: 'Zero-based offset into the public archive, newest first'[\s\S]*?default: 0/,
    'manual and push recovery must start at the newest archive batch');
  assert.match(workflowSource,/SPINE_REPAIR_OFFSET:.*inputs\.offset \|\| '0'/,
    'push and manual recovery must start at offset zero unless a successor batch supplies an explicit offset');
  assert.doesNotMatch(workflowSource,/github\.event_name == 'push' && '50'/,
    'push must not silently skip the newest 50 archive entries');
  assert.match(workflowSource,/github[.]event_name != 'schedule'/,'the scheduled maintenance path must not fan out through the full archive');
  assert.match(workflowSource,/actions:\s*write/,'the batch runner needs permission to dispatch its successor');
  const verifySource=fs.readFileSync(path.join(path.dirname(script),'verify-latest-twenty-live.mjs'),'utf8');
  const maskSource=fs.readFileSync(path.join(path.dirname(script),'mask-preview-manifest.mjs'),'utf8');
  assert.match(verifySource,/blocked-invisible-default-skin/);
  assert.match(verifySource,/\['SPINE_VERSION_UNKNOWN','UNSUPPORTED_SPINE_WEB_PLAYER_VERSION'\]\.includes\(work\.blockedReason\)[\s\S]*?record\.webmStatus==='failed' && record\.previewStatus==='failed'/,
    'historical failures for sources known to be unsupported by the pinned runtime are reported as blockers');
  assert.match(verifySource,/work\.ready===false && record\.previewStatus==='blocked'[\s\S]*?record\.webmStatus\.startsWith\('blocked-'\)/,
    'known incomplete or unsupported source configurations stay blocked instead of becoming production failures');
  assert.match(verifySource,/blocked-static-animation/);
  for(const status of ['blocked-invalid-default-animation','blocked-incomplete-source','blocked-unsupported-runtime']){
    assert.match(repairSource,new RegExp(status));
    assert.match(verifySource,new RegExp(status));
  }
  assert.match(verifySource,/expectedMedia:ready\*fields\.length/);
  assert.match(verifySource,/REPAIR_IDS_FILE/);
  assert.match(maskSource,/REPAIR_IDS_FILE/);
  console.log('PASS latest50: source-track fallback, skin retry, frozen source, incomplete-source guard, no fake media');
}finally{fs.rmSync(root,{recursive:true,force:true});}
