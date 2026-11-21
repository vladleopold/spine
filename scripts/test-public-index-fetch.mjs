import assert from 'node:assert/strict';
import {fetchPublicIndex} from './lib/fetch-public-index.mjs';

// Simulate a collection index larger than the GitHub Contents API's 1 MiB
// inline-content threshold. Raw GitHub must return the entire JSON document.
const entries=Array.from({length:9000},(_,i)=>({
  id:`fixture-${i}`,
  metadata:'x'.repeat(128),
}));
const largeJson=JSON.stringify(entries);
assert.ok(Buffer.byteLength(largeJson)>1_000_000);
let request;
const loaded=await fetchPublicIndex('library_02',{
  fetchImpl:async(url,options)=>{
    request={url,options};
    return {ok:true,status:200,text:async()=>largeJson};
  },
});
assert.equal(loaded.length,9000);
assert.equal(loaded[8999].id,'fixture-8999');
assert.match(request.url,/^https:\/\/raw\.githubusercontent\.com\/vladleopold\/spine\/main\/library_02\/index\.json$/);
assert.equal(request.options.cache,'no-store');
assert.equal(request.options.headers,undefined,'public raw index fetch must not forward GitHub credentials');

await assert.rejects(()=>fetchPublicIndex('../library',{fetchImpl:async()=>{throw new Error('must not fetch')}}),/Unsafe collection/);
await assert.rejects(()=>fetchPublicIndex('library',{fetchImpl:async()=>({ok:true,text:async()=>''})}),/response was empty/);
await assert.rejects(()=>fetchPublicIndex('library',{fetchImpl:async()=>({ok:true,text:async()=>'not-json'})}),/not valid JSON/);
await assert.rejects(()=>fetchPublicIndex('library',{fetchImpl:async()=>({ok:false,status:404,text:async()=>''})}),/Cannot read current index 404/);
console.log('PASS public index verifier reads complete >1 MiB raw index and rejects malformed responses');
