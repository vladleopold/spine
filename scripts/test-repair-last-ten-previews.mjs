#!/usr/bin/env node
// Pure fixture regression: no network, proprietary source files, renderer or uploads.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";

const script=fileURLToPath(new URL("./repair-last-ten-previews.mjs",import.meta.url));
const source=fs.readFileSync(script,"utf8");
const workflowPath=fileURLToPath(new URL("../.github/workflows/repair-last-ten-previews.yml",import.meta.url));
const workflow=fs.readFileSync(workflowPath,"utf8");
assert.match(workflow,/group:\s*spine-preview-latest-ten-\$\{\{\s*github\.event_name\s*\}\}-\$\{\{\s*github\.ref\s*\}\}/,
  "PR and main repair runs must use separate concurrency groups");
assert.match(workflow,/cancel-in-progress:\s*false/,
  "a read-only PR check must never cancel an active main repair");
assert.match(workflow,/branches:.*fix\/latest10-explicit-animation-guard-20261120/,
  "the exact feature branch must run the read-only inventory check");
assert.match(workflow,/branches:.*fix\/latest10-public-only-inventory-20261120/,
  "the public-only inventory regression branch must run the read-only check");
assert.match(workflow,/branches:.*fix\/latest10-preserve-source-blockers-20261120/,
  "the source-blocker preservation regression branch must run the read-only check");
assert.doesNotMatch(workflow,/^\s+pull_request:/m,
  "use one push-triggered feature-branch check, not duplicate push and pull_request runs");
assert.ok(!source.includes("record.defaultAnimation=animation"),
  "preview repair must not rewrite the source index default animation");
const root=fs.mkdtempSync(path.join(os.tmpdir(),"spine-latest10-animation-"));
try{
  const shard=path.join(root,"library_02");
  fs.mkdirSync(shard,{recursive:true});
  const targetId="Spine-animation-2026-11-17T18-45-14-132Z";
  const missingId="fixture-no-default";
  const incompatibleId="fixture-incompatible";
  const records=Array.from({length:13},(_,i)=>{
    const hidden=i===0;
    const testOnly=i===1;
    const incompatible=i===2;
    const publicIndex=i-3;
    const id=hidden?"fixture-hidden":testOnly?"fixture-test-only":incompatible?incompatibleId:publicIndex===0?targetId:publicIndex===1?missingId:"fixture-"+String(publicIndex).padStart(2,"0");
    const defaultAnimation=hidden||testOnly||incompatible?"idle":publicIndex===0?"Idle Post Climax Cum":publicIndex===1?undefined:"idle";
    const uploadedAt=new Date(Date.UTC(2026,10,20,0,12-i,0)).toISOString();
    const previewPath="library_02/"+id;
    const webmPreview="https://spine-link.vercel.app/assets/"+previewPath+"/preview.webm";
    const webpPoster="https://spine-link.vercel.app/assets/"+previewPath+"/preview.webp";
    const record={
      id,uploadedAt,previewPath,
      ...(hidden?{hiddenFromPublicLibrary:true}:{}),
      ...(testOnly?{testOnly:true}:{}),
      ...(defaultAnimation?{defaultAnimation}:{}),
      animations:defaultAnimation?[defaultAnimation]:["idle"],
      webmStatus:incompatible?"blocked-incompatible-source-version":"ready",
      previewStatus:incompatible?"blocked":"ready",
      ...(incompatible?{previewError:"Spine 3.8.75 export is rejected by official runtimes; re-export from the original Spine project required"}:{}),
      webmPreview,webpPoster,
      previewFrameCount:60,previewDuration:2,
      files:[incompatible?"source.json":"source.skel","source.atlas","source.png"],
      allAnimationPreviews:defaultAnimation?{
        [defaultAnimation]:{webmPreview,webpPoster}
      }:{},
    };
    const folder=path.join(root,previewPath);
    fs.mkdirSync(folder,{recursive:true});
    if(incompatible)fs.writeFileSync(path.join(folder,"source.json"),JSON.stringify({skeleton:{spine:"3.8.75"},bones:[]}));
    else fs.writeFileSync(path.join(folder,"source.skel"),"fixture");
    fs.writeFileSync(path.join(folder,"source.atlas"),"fixture");
    fs.writeFileSync(path.join(folder,"source.png"),"fixture");
    return record;
  });
  const indexPath=path.join(shard,"index.json");
  fs.writeFileSync(indexPath,JSON.stringify(records));
  const env={...process.env,SPINE_REPAIR_INDEX_ONLY:"1"};
  const inventory=spawnSync(process.execPath,[script,"matrix"],{
    cwd:root,encoding:"utf8",env
  });
  assert.equal(inventory.status,0,inventory.stderr);
  const output=Object.fromEntries(inventory.stdout.split("\n").filter(x=>x.includes("="))
    .map(x=>[x.slice(0,x.indexOf("=")),x.slice(x.indexOf("=")+1)]));
  const all=JSON.parse(output.allEntries);
  const render=JSON.parse(output.matrix);
  assert.equal(all.length,10);
  assert.ok(!all.some(x=>x.id==="fixture-hidden"||x.id==="fixture-test-only"),
    "hidden and test-only records must never enter the public repair snapshot");
  const missing=all.find(x=>x.id===missingId);
  assert.equal(missing.ready,false);
  assert.equal(missing.needsRender,false);
  assert.equal(missing.animation,"");
  assert.equal(missing.blockedReason,"MISSING_DEFAULT_ANIMATION");
  assert.ok(!render.some(x=>x.id===missingId),
    "an entry without an explicit default animation must never enter the render matrix");
  const incompatible=all.find(x=>x.id===incompatibleId);
  assert.equal(incompatible.ready,false);
  assert.equal(incompatible.needsRender,false);
  assert.equal(incompatible.blockedReason,"INCOMPATIBLE_SOURCE_VERSION");
  assert.ok(!render.some(x=>x.id===incompatibleId&&x.needsRender===true),
    "an incompatible Spine 3.8.75 source must never be scheduled for rendering");
  const target=all.find(x=>x.id===targetId);
  assert.equal(target.ready,true);
  assert.equal(target.animation,"Idle Post Climax Cum");
  assert.equal(target.needsRender,false);

  const publish=spawnSync(process.execPath,[script,"merge"],{
    cwd:root,encoding:"utf8",
    env:{...env,REPAIR_IDS_JSON:JSON.stringify(all)}
  });
  assert.equal(publish.status,0,publish.stderr);
  const saved=JSON.parse(fs.readFileSync(indexPath,"utf8"));
  const blocked=saved.find(x=>x.id===missingId);
  assert.equal(blocked.webmStatus,"blocked-missing-animation-selection");
  assert.equal(blocked.previewStatus,"blocked");
  assert.equal(Object.hasOwn(blocked,"defaultAnimation"),false,
    "the blocked record must not acquire a guessed default");
  const savedIncompatible=saved.find(x=>x.id===incompatibleId);
  assert.equal(savedIncompatible.webmStatus,"blocked-incompatible-source-version");
  assert.equal(savedIncompatible.previewStatus,"blocked");
  assert.match(savedIncompatible.previewError,/Spine 3\.8\.75/);
  const savedTarget=saved.find(x=>x.id===targetId);
  assert.equal(savedTarget.defaultAnimation,"Idle Post Climax Cum");
  assert.equal(savedTarget.webmStatus,"ready");
  console.log("PASS latest10: missing default stays blocked, incompatible Spine source keeps its specific blocker, no animation substitution");
}finally{
  fs.rmSync(root,{recursive:true,force:true});
}
