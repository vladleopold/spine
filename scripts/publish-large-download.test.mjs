import test from 'node:test';import assert from 'node:assert/strict';import fs from 'node:fs';import os from 'node:os';import path from 'node:path';import {publishLargeDownload} from './publish-large-download.mjs';
test('binary upload streams exact bytes and reuses verified immutable asset',async()=>{
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'release-test-')),file=path.join(dir,'alpha.mov');const bytes=Buffer.from([0,255,128,1]);fs.writeFileSync(file,bytes);
 let asset=null,uploads=0;
 const mock=async(url,options={})=>{
  if(url.includes('/releases/tags/'))return Response.json({id:1,upload_url:'https://uploads.github.com/repos/test/spine/releases/1/assets{?name,label}'});
  if(url.includes('/releases/1/assets?per_page'))return Response.json(asset?[asset]:[]);
  if(url.startsWith('https://uploads.github.com/')){
   const chunks=[];for await(const chunk of options.body)chunks.push(chunk);assert.deepEqual(Buffer.concat(chunks),bytes);uploads++;
   asset={name:new URL(url).searchParams.get('name'),state:'uploaded',size:bytes.length,browser_download_url:'https://github.com/test/spine/releases/download/render-test/asset.mov'};return Response.json(asset);
  }throw Error(url);
 };
 try{const options={repository:'test/spine',token:'test',uploadId:'test',fetchImpl:mock};const first=await publishLargeDownload(file,options);assert.equal(await publishLargeDownload(file,options),first);assert.equal(uploads,1);}finally{fs.rmSync(dir,{recursive:true,force:true});}
});

test('release API requests abort and classify request timeouts', async () => {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'release-timeout-test-'));
 const file=path.join(dir,'alpha.mov');
 fs.writeFileSync(file,Buffer.from([1,2,3]));
 const hangingFetch=(_url,{signal}={})=>new Promise((_resolve,reject)=>{
  if(signal?.aborted){reject(signal.reason);return;}
  signal?.addEventListener('abort',()=>reject(signal.reason||new Error('aborted')),{once:true});
 });
 try {
  await assert.rejects(
   publishLargeDownload(file,{repository:'test/spine',token:'test',uploadId:'timeout',fetchImpl:hangingFetch,requestTimeoutMs:15}),
   error=>error.code==='DOWNLOAD_REQUEST_TIMEOUT',
  );
 } finally {
  fs.rmSync(dir,{recursive:true,force:true});
 }
});


test('release metadata body remains covered by the request timeout', async () => {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'release-body-timeout-test-'));
 const file=path.join(dir,'alpha.mov');
 fs.writeFileSync(file,Buffer.from([1,2,3]));
 const hangingBodyFetch=(_url,{signal}={})=>Promise.resolve({
  status:200,
  ok:true,
  json:()=>new Promise((_resolve,reject)=>{
   if(signal?.aborted){reject(signal.reason);return;}
   signal?.addEventListener('abort',()=>reject(signal.reason||new Error('aborted')),{once:true});
  }),
 });
 try {
  await assert.rejects(
   Promise.race([
    publishLargeDownload(file,{repository:'test/spine',token:'test',uploadId:'body-timeout',fetchImpl:hangingBodyFetch,requestTimeoutMs:20}),
    new Promise((_,reject)=>setTimeout(()=>reject(new Error('test guard: response body was not aborted')),250)),
   ]),
   error=>error.code==='DOWNLOAD_REQUEST_TIMEOUT',
  );
 } finally {
  fs.rmSync(dir,{recursive:true,force:true});
 }
});


test('large asset upload aborts a stalled streaming request at its upload timeout', async () => {
 const dir=fs.mkdtempSync(path.join(os.tmpdir(),'release-upload-timeout-test-'));
 const file=path.join(dir,'large.mov');
 fs.writeFileSync(file,Buffer.alloc(1024,7));
 let uploadStarted=false;
 const hangingUploadFetch=async (url,{signal}={})=>{
  if(url.includes('/releases/tags/'))return Response.json({id:7,upload_url:'https://uploads.github.com/repos/test/spine/releases/7/assets{?name,label}'});
  if(url.includes('/releases/7/assets?per_page'))return Response.json([]);
  if(url.startsWith('https://uploads.github.com/')){
   uploadStarted=true;
   return await new Promise((_resolve,reject)=>{
    if(signal?.aborted){reject(signal.reason||new Error('aborted'));return;}
    signal?.addEventListener('abort',()=>reject(signal.reason||new Error('aborted')),{once:true});
   });
  }
  throw Error(url);
 };
 try {
  await assert.rejects(
   publishLargeDownload(file,{repository:'test/spine',token:'test',uploadId:'upload-timeout',fetchImpl:hangingUploadFetch,requestTimeoutMs:100,uploadTimeoutMs:20}),
   error=>error.code==='DOWNLOAD_REQUEST_TIMEOUT'&&error.timeoutMs===20,
  );
  assert.equal(uploadStarted,true);
 } finally {
  fs.rmSync(dir,{recursive:true,force:true});
 }
});
