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
const singleWorkflowSource=fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)),'../.github/workflows/spine-export-webm.yml'),'utf8');
const exportAllWorkflowSource=fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)),'../.github/workflows/spine-export-all.yml'),'utf8');
const exportFullWorkflowSource=fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)),'../.github/workflows/spine-export-full.yml'),'utf8');
const lastTenWorkflowSource=fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)),'../.github/workflows/repair-last-ten-previews.yml'),'utf8');
const reportedWorkflowSource=fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)),'../.github/workflows/repair-reported-previews.yml'),'utf8');
const publicRunner='runs-on: ubuntu-24.04';
function jobUsesPublicRunner(source,jobName){
  const marker=`  ${jobName}:\n`;
  const start=source.indexOf(marker);
  if(start<0)return false;
  const next=/\n  [A-Za-z0-9_-]+:\n/g;
  next.lastIndex=start+marker.length;
  const match=next.exec(source);
  const block=source.slice(start,match?match.index:source.length);
  return block.includes(publicRunner) && !block.includes('self-hosted');
}
assert.ok(!repairSource.includes('record.defaultAnimation=animation'),
  'publishing a preview must never rewrite the source index default animation');
assert.match(repairSource,/const sourcePaths=latest\.map\(entry=>[\s\S]*?normalizedPreviewPath\(entry\.basePath,entry\.previewPath,entry\.id\)/,
  'production inventory hydrates every selected source directory before inspecting source completeness');
assert.ok(!repairSource.includes('const sourcePaths=latest.filter(entry=>'),
  'optional legacy index.files metadata must not hide existing source bundles from sparse checkout');
const liveAudit=fs.readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)),'verify-latest-twenty-live.mjs'),'utf8');
assert.match(liveAudit,/publishedSha=String\(process\.env\.PUBLISHED_SHA\|\|''\)/);
assert.match(liveAudit,/raw\.githubusercontent\.com\/['"]\+repo\+['"]\/['"]\+publishedSha/);
assert.match(workflowSource,/published_sha: \$\{\{ steps\.publish\.outputs\.published_sha \}\}/);
assert.match(workflowSource,/PUBLISHED_SHA: \$\{\{ needs\.publish\.outputs\.published_sha \}\}/);
assert.match(workflowSource,/echo "published_sha=\$\(git rev-parse HEAD\)" >> "\$GITHUB_OUTPUT"/);
assert.match(liveAudit,/const expectedBlockedAnimation=String\(work\.animation\|\|record\.defaultAnimation\|\|''\)/);
assert.match(liveAudit,/const blockedAnimationMatches=expectedBlockedAnimation==='__SPINE_AUTO__'[\s\S]*?Boolean\(String\(record\.previewBlockedAnimation\|\|''\)\.trim\(\)\)/);
assert.match(liveAudit,/blockedAnimationMatches[\s\S]*?previewBlockedSourceFingerprint===work\.sourceFingerprint/);
assert.match(liveAudit,/renderableCandidates=snapshot\.filter\(work=>work\.ready===true\)\.length/);
assert.match(liveAudit,/if\(failed\|\|mutatedSource\|\|ready\+blocked!==snapshot\.length\)process\.exitCode=1/,
  'known source blockers must remain visible without stopping later archive offsets');
assert.ok(!liveAudit.includes('if(failed||blocked||ready!==snapshot.length'),
  'a source-blocked record must not prevent later batches from being repaired');
const blockedAnimationMatches=(expected,actual)=>expected==='__SPINE_AUTO__'?Boolean(String(actual||'').trim()):actual===expected;
assert.equal(blockedAnimationMatches('__SPINE_AUTO__','Idle'),true,
  'automatic selection may record the actual resolved track name');
assert.equal(blockedAnimationMatches('__SPINE_AUTO__',''),false,
  'automatic selection still requires a recorded blocked track');
assert.equal(blockedAnimationMatches('Walk','Walk'),true);
assert.equal(blockedAnimationMatches('Walk','Idle'),false);
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
  // A failed frame-zero poster refresh must force a fresh render even when
  // the previous WebM/metadata set still passes the lightweight reuse check.
  records[6].webmStatus='failed';
  records[6].previewStatus='failed';
  records[6].previewAnimation='Idle';
  records[6].allAnimationPreviews={Idle:{webmPreview:'https://example.test/preview.webm',
    webpPoster:'https://example.test/preview.webp'}};
  records[6].webmPreview='https://example.test/preview.webm';
  records[6].webpPoster='https://example.test/preview.webp';
  records[6].previewFrameCount=12;
  records[6].previewDuration=2;
  records[6].previewError='Existing WebM could not produce its exact first-frame WebP poster';
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
  if(matrix.length!==18)console.log('FIXTURE_MATRIX_DIAGNOSTICS='+JSON.stringify(all.map(x=>({id:x.id,ready:x.ready,needsRender:x.needsRender,posterRefreshFailed:x.posterRefreshFailed,blockedReason:x.blockedReason,animation:x.animation}))));
  assert.equal(matrix.length,18,
    'the supported Spine 3.7 binary fixture must join the render matrix through the 3.8 runtime');
  assert.equal(Number(output.renderCount),18);
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
  assert.equal(legacyBinary.ready,true);
  assert.equal(legacyBinary.needsRender,true);
  assert.equal(legacyBinary.blockedReason,'',
    'Spine 3.7 binary-only source must enter the render matrix through the bundled 3.8 runtime');
  assert.ok(all.slice(3).filter(x=>!['fixture-19','fixture-18','fixture-05'].includes(x.id)).every(x=>x.ready&&x.needsRender));
  const posterFailure=all.find(x=>x.id==='fixture-06');
  assert.equal(posterFailure.posterRefreshFailed,true,
    'the indexed poster-refresh error must survive inventory normalization');
  assert.equal(posterFailure.needsRender,true,
    'a failed exact first-frame WebP recovery must force a fresh render even when old media passes reuse checks');
  assert.ok(matrix.some(x=>x.id==='fixture-06'));
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
  assert.match(repairSource,/PREVIEW_RENDERER_REVISION="auto-track-recovery-v15-configured-default-skin-list"/);
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
  assert.equal(matrixFifty.length,48,'the compatible Spine 3.7 binary joins the render matrix; incomplete sources stay blocked and one verified reusable preview is not rerendered');
  assert.equal(Number(fiftyOutput.renderCount),48);
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

  const partialResult=spawnSync(process.execPath,[script,'matrix'],{
    cwd:root,encoding:'utf8',env:{...process.env,SPINE_REPAIR_INDEX_ONLY:'1',
      SPINE_REPAIR_SKIP_LIVE:'1',SPINE_REPAIR_LIMIT:'10',SPINE_REPAIR_OFFSET:'55'}});
  assert.equal(partialResult.status,0,partialResult.stderr);
  const partialOutput=Object.fromEntries(partialResult.stdout.split('\n').filter(x=>x.includes('='))
    .map(x=>[x.slice(0,x.indexOf('=')),x.slice(x.indexOf('=')+1)]));
  const partialBatch=JSON.parse(fs.readFileSync(path.join(root,'repair-manifest.json'),'utf8'));
  assert.equal(partialBatch.length,5,'the final archive batch may contain fewer than the configured maximum');
  assert.equal(Number(partialOutput.offset),55);
  assert.equal(Number(partialOutput.totalCount),60);
  assert.equal(Number(partialOutput.nextOffset),60,'a partial final batch must stop exactly at archive end');
  assert.ok(partialBatch.every(x=>x.id.startsWith('older-fixture-')),'partial batch must retain the exact older records');
  const publishJobBlock=workflowSource.split('  publish:\\n')[1]?.split('\\n  verify-production:')[0]||'';
  assert.match(publishJobBlock,/if:.*needs\\.render\\.result == 'success'/,
    'preview publication must not run after a failed or cancelled render matrix');

  assert.match(workflowSource,/dispatch-next-batch/,'successful publication must queue the next archive batch');
  // The requested latest-70 recovery must render only on the dedicated Ubuntu worker.
  assert.match(workflowSource,/render:\s+name: validate-latest50-[\s\S]*?runs-on: ubuntu-24\.04/,
    'actual Spine rendering must use public GitHub-hosted Ubuntu runners');
  assert.ok(workflowSource.includes("group: spine-preview-latest-twenty-${{ github.ref }}-${{ github.event_name }}"),
    'only one archive repair batch may run at a time');
  assert.ok(workflowSource.includes('cancel-hosted-batches:') &&
    workflowSource.includes('actions: write') &&
    workflowSource.includes('actions/runs/${run_id}/cancel'),
    'the first main-branch batch must cancel legacy GitHub-hosted render batches');
  assert.ok(workflowSource.includes('actions/runs?per_page=100') &&
    !workflowSource.includes('gh api --paginate'),
    'legacy batch cancellation must inspect only the latest 100 runs without unbounded pagination');
  assert.ok(workflowSource.includes('jq -r --arg current_run "$GITHUB_RUN_ID"') &&
    !workflowSource.includes('env.GITHUB_RUN_ID') &&
    workflowSource.includes('select(.head_branch == "main")'),
    'the cancellation filter must explicitly exclude this run and only cancel older main-branch batches');
  assert.ok(workflowSource.includes('needs: [inventory, runtime-package-smoke, cancel-hosted-batches]'),
    'real rendering must wait until legacy hosted batches have been cancelled');
  assert.ok(workflowSource.includes('cancel-in-progress: true'),
    'a corrected runner target must cancel an already-running hosted batch');
  assert.ok(workflowSource.includes('fromJSON(needs.inventory.outputs.nextOffset) < 70'),
    'automatic recovery must stop after the newest 70 works');
  assert.ok(workflowSource.includes('remaining=$(( 70 - NEXT_OFFSET ))'),
    'the second batch must be limited to the remaining 20 works, not another 50');
  assert.ok(workflowSource.includes("needs.render.result == 'success'") &&
    workflowSource.includes("needs.publish.result == 'success'") &&
    !workflowSource.includes("needs.verify-production.result == 'success'"),
    'a later batch must require successful rendering and verified-only publication, but allow independent batches after partial live-audit failures');

  assert.ok(workflowSource.includes('scripts/repair-latest-70-trigger.json'),
    'only the explicit latest-70 trigger file may start an automatic archive batch');
  assert.ok(!workflowSource.includes('  schedule:'),
    'archive recovery must not run unattended every day');

  assert.ok(singleWorkflowSource.includes('  export:') &&
    singleWorkflowSource.includes('runs-on: ubuntu-24.04'),
    'single-item WebM rendering must also use public ubuntu-24.04');
  assert.ok(singleWorkflowSource.includes("- 'scripts/render-check.json'") &&
    !singleWorkflowSource.includes("- 'scripts/spine-export-webm.mjs'"),
    'renderer code changes must not launch a new one-off export');

  assert.ok(jobUsesPublicRunner(exportAllWorkflowSource,'export'),
    'full archive export rendering must use public ubuntu-24.04');
  assert.ok(jobUsesPublicRunner(exportFullWorkflowSource,'export-opaque') &&
    jobUsesPublicRunner(exportFullWorkflowSource,'export-alpha'),
    'both full-export render lanes must use public ubuntu-24.04');
  assert.ok(jobUsesPublicRunner(lastTenWorkflowSource,'render'),
    'last-ten recovery rendering must use public ubuntu-24.04');
  assert.ok(jobUsesPublicRunner(reportedWorkflowSource,'render'),
    'reported-project recovery rendering must use public ubuntu-24.04');

  console.log('PASS latest50: source-track fallback, skin retry, frozen source, public runner, no fake media');
}finally{fs.rmSync(root,{recursive:true,force:true});}
