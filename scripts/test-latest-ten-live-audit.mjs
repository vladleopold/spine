#!/usr/bin/env node
import assert from "node:assert/strict";
import { auditLatestTen } from "./lib/latest-ten-live-audit.mjs";

const ready={
  id:"wolf-2026-11-20T00-00-00-000Z",
  basePath:"library_02",
  previewPath:"library_02/wolf-2026-11-20T00-00-00-000Z",
  ready:true,
  animation:"idle",
  blockedReason:"",
};
const blocked=()=>({
  id:"fixture-no-animation",
  basePath:"library_02",
  previewPath:"library_02/fixture-no-animation",
  ready:false,
  animation:"",
  blockedReason:"MISSING_DEFAULT_ANIMATION",
});
const items=[ready,...Array.from({length:9},blocked)];
const webm=Uint8Array.of(0x1a,0x45,0xdf,0xa3,0x00);
const webp=Uint8Array.of(0x52,0x49,0x46,0x46,0x04,0x00,0x00,0x00,0x57,0x45,0x42,0x50);
const requested=[];
const fetchOk=async url=>{
  requested.push(String(url));
  return new Response(String(url).endsWith(".webm")?webm:webp,{status:206});
};
let pairCalls=0;
let pairArgs;
const verifyPair=async args=>{pairCalls++;pairArgs=args;return true;};
const options={retries:1,delayMs:0,verifyPair};
const result=await auditLatestTen(items,fetchOk,options);
assert.deepEqual(result,{total:10,ready:1,blocked:9,failed:0,decodedPairs:1});
assert.equal(pairCalls,1,"the ready item must be decoded as a same-work pair");
assert.equal(pairArgs.videoUrl,"https://spine-link.vercel.app/assets/library_02/wolf-2026-11-20T00-00-00-000Z/preview.webm");
assert.equal(pairArgs.posterUrl,"https://spine-link.vercel.app/assets/library_02/wolf-2026-11-20T00-00-00-000Z/preview.webp");
assert.equal(pairArgs.expectedPrefix,"/assets/library_02/wolf-2026-11-20T00-00-00-000Z/");
assert.equal(requested.length,6,"all six public media variants must be checked");
assert.ok(requested.every(url=>url.startsWith("https://spine-link.vercel.app/assets/")));

const unsafe=items.map((item,index)=>index===0?{...item,previewPath:"library_02/../secret"}:item);
assert.deepEqual(
  await auditLatestTen(unsafe,fetchOk,options),
  {total:10,ready:0,blocked:9,failed:1,decodedPairs:0},
  "unsafe manifest paths must fail closed",
);
const unknown=items.map((item,index)=>index===1?{...item,blockedReason:"UNKNOWN_BLOCKER"}:item);
assert.deepEqual(
  await auditLatestTen(unknown,fetchOk,options),
  {total:10,ready:1,blocked:8,failed:1,decodedPairs:1},
  "unknown blocked states must not be accepted as valid blockers",
);
await assert.rejects(
  ()=>auditLatestTen(items.slice(0,9),fetchOk,options),
  /exact ten-entry inventory manifest/,
);
console.log("PASS latest10 live audit: exact manifest, six media variants, and fail-closed blockers");
