#!/usr/bin/env node
// Pure fixture regression for the exact 18-work manifest plus its priority target.
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {spawnSync} from "node:child_process";
import {fileURLToPath} from "node:url";

const script=fileURLToPath(new URL("./repair-reported-previews.mjs",import.meta.url));
const source=fs.readFileSync(script,"utf8");
const idsMatch=source.match(/const requestedIds=(\[[\s\S]*?\]);/);
assert.ok(idsMatch,"the repair manifest must remain explicit");
const ids=JSON.parse(idsMatch[1]);
assert.equal(ids.length,19,"keep the 18 reported works and the separate priority target");
const targetId=ids[18];
const missingDefaultId=ids[0];
const missingSelectedId=ids[1];
const mismatchedPreviewId=ids[2];
const acceptedId=ids[3];
const root=fs.mkdtempSync(path.join(os.tmpdir(),"spine-priority-preview-"));
try {
  const collection=path.join(root,"library_02");
  fs.mkdirSync(collection,{recursive:true});
  const records=ids.map((id,index)=>{
    const isTarget=index===18;
    const missingDefault=index===0;
    const missingSelected=index===1;
    const mismatched=index===2;
    const accepted=index===3;
    const missingTier=index===4;
    const animation=isTarget?"Idle Post Climax Cum":missingDefault?"":missingSelected?"walk":"idle";
    const animations=missingSelected?["idle"]:animation?[animation]:["idle"];
    const record={
      id,
      uploadedAt:new Date(Date.UTC(2026,10,20,0,19-index)).toISOString(),
      previewPath:"library_02/"+id,
      files:["source.skel","source.atlas","source.png"],
      animations,
      ...(animation?{defaultAnimation:animation}:{}),
      webmStatus:"ready",
      previewStatus:isTarget?"failed":"ready",
      webmPreview:"https://spine-link.vercel.app/assets/library_02/"+id+"/preview.webm",
      webmPreviewMedium:"https://spine-link.vercel.app/assets/library_02/"+id+"/preview-medium.webm",
      webmPreviewLow:"https://spine-link.vercel.app/assets/library_02/"+id+"/preview-low.webm",
      webpPoster:"https://spine-link.vercel.app/assets/library_02/"+id+"/preview.webp",
      webpPosterMedium:missingTier?"":"https://spine-link.vercel.app/assets/library_02/"+id+"/preview-medium.webp",
      webpPosterLow:"https://spine-link.vercel.app/assets/library_02/"+id+"/preview-low.webp",
      ...(accepted?{webmAnimation:"idle"}:{}),
      ...(mismatched?{webmAnimation:"other"}:{}),
      ...(!isTarget&&!missingDefault&&!missingSelected&&!mismatched&&!accepted?{webmAnimation:"idle"}:{}),
      previewFrameCount:60,
      previewDuration:2,
    };
    const folder=path.join(root,record.previewPath);
    fs.mkdirSync(folder,{recursive:true});
    fs.writeFileSync(path.join(folder,"source.skel"),"fixture");
    fs.writeFileSync(path.join(folder,"source.atlas"),"fixture");
    fs.writeFileSync(path.join(folder,"source.png"),"fixture");
    return record;
  });
  fs.writeFileSync(path.join(collection,"index.json"),JSON.stringify(records));
  const result=spawnSync(process.execPath,[script,"matrix"],{
    cwd:root,
    encoding:"utf8",
    env:{...process.env,SPINE_REPAIR_INDEX_ONLY:"1"},
  });
  assert.equal(result.status,0,result.stderr);
  const output=Object.fromEntries(result.stdout.split("\n").filter(x=>x.includes("="))
    .map(x=>[x.slice(0,x.indexOf("=")),x.slice(x.indexOf("=")+1)]));
  const all=JSON.parse(output.allEntries);
  const render=JSON.parse(output.matrix);
  assert.equal(all.length,19);
  const target=all.find(x=>x.id===targetId);
  assert.equal(target.ready,true);
  assert.equal(target.animation,"Idle Post Climax Cum");
  assert.equal(target.needsRender,true,
    "webmStatus=ready must not hide previewStatus=failed or missing exact-render metadata");
  assert.ok(render.some(x=>x.id===targetId&&x.needsRender===true));
  const missingDefault=all.find(x=>x.id===missingDefaultId);
  assert.equal(missingDefault.ready,false);
  assert.equal(missingDefault.blockedReason,"MISSING_DEFAULT_ANIMATION");
  assert.ok(!render.some(x=>x.id===missingDefaultId));
  const missingSelected=all.find(x=>x.id===missingSelectedId);
  assert.equal(missingSelected.ready,false);
  assert.equal(missingSelected.blockedReason,"MISSING_SELECTED_ANIMATION");
  assert.ok(!render.some(x=>x.id===missingSelectedId));
  const mismatch=all.find(x=>x.id===mismatchedPreviewId);
  assert.equal(mismatch.needsRender,true,"a preview rendered from another animation must be regenerated");
  assert.ok(render.some(x=>x.id===mismatchedPreviewId&&x.needsRender===true));
  const accepted=all.find(x=>x.id===acceptedId);
  assert.equal(accepted.needsRender,false,"a verified exact-identity preview with all tiers must not be rendered twice");
  const missingTier=all.find(x=>x.id===ids[4]);
  assert.equal(missingTier.needsRender,true,"a missing responsive poster tier must trigger repair");
  assert.doesNotMatch(source,/alternatePreviewAnimations|targetAnimation\s*=\s*candidate/);
  assert.match(source,/record\.webmAnimation=animation/);
  console.log("PASS priority repair matrix: exact target retried, absent/mismatched animations blocked, accepted media skipped");
} finally {
  fs.rmSync(root,{recursive:true,force:true});
}
