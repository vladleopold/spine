#!/usr/bin/env node
import assert from "node:assert/strict";
import { previewSourceFingerprint, validateFrozenRepairRecord } from "./repair-manifest-guard.mjs";

const root="/tmp/spine-preview-test";
const a={id:"wolf-2026-11-18T17-32-08-569Z",uploadedAt:"2026-11-18T17:32:08.569Z",
  files:["wolf.skel","wolf.atlas","wolf.png"],previewPath:"library_02/wolf-2026-11-18T17-32-08-569Z"};
const entry={id:a.id,basePath:"library_02",previewPath:a.previewPath,uploadedAt:Date.parse(a.uploadedAt),
  sourceFingerprint:previewSourceFingerprint(a),ready:true,needsRender:true};
const folders=["library","library_02"];
let records=[{...a}];
const index=(rootArg, folder)=>folder==="library_02"?records:[];
// A newer upload arrives during a long-running export: its date must not
// revoke trust in this immutable, still-present source record.
records=[{id:"newer",uploadedAt:"2026-11-18T22:00:00.000Z",files:["new.skel"]},a];
assert.equal(validateFrozenRepairRecord(root,entry,folders,index).id,a.id);
assert.throws(()=>validateFrozenRepairRecord(root,{...entry,id:"other"},folders,index));
assert.throws(()=>validateFrozenRepairRecord(root,{...entry,basePath:"library_99"},folders,index));
assert.throws(()=>validateFrozenRepairRecord(root,{...entry,previewPath:"library_02/../secrets"},folders,index));
assert.throws(()=>validateFrozenRepairRecord(root,{...entry,uploadedAt:entry.uploadedAt+1},folders,index));
assert.throws(()=>validateFrozenRepairRecord(root,{...entry,sourceFingerprint:"f".repeat(64)},folders,index));
records=[{...a,files:[...a.files,"replacement.png"]}];
assert.throws(()=>validateFrozenRepairRecord(root,entry,folders,index));
records=[{...a,previewPath:"library_02/other"}];
assert.throws(()=>validateFrozenRepairRecord(root,entry,folders,index));
records=[{...a,uploadedAt:"2026-11-18T17:32:09.569Z"}];
assert.throws(()=>validateFrozenRepairRecord(root,entry,folders,index));
records=[a,a];
assert.throws(()=>validateFrozenRepairRecord(root,entry,folders,index));
records=[];
assert.throws(()=>validateFrozenRepairRecord(root,entry,folders,index));
console.log("PREVIEW_REPAIR_FROZEN_MANIFEST_TESTS_PASSED");
