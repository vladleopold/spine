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
