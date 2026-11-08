import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const source=readFileSync(new URL('./render-work.mjs',import.meta.url),'utf8');
const code=source.slice(source.indexOf('async function pushStaged('),source.indexOf('\nconst url=file'));
test('publish retries only failed asset and writes index last',async()=>{
 const calls=[];let staged=[],failed=false,written;
 const pending=[{src:'a',dst:'work/a.mov'},{src:'b',dst:'work/b.zip'}];
 const run=(cmd,args)=>{calls.push(args);if(args[0]==='add')staged=[args.at(-1)];if(args.includes('push')&&staged[0]==='work/b.zip'&&!failed){failed=true;throw Error('HTTP 408');}};
 const fs={mkdirSync(){},copyFileSync(){},writeFileSync(_path,value){written=JSON.parse(value);}};
 const entry={id:'elle',allAnimationPreviews:{other:{ready:true}}};
 const publish=new Function('run','execFileSync','fs','path','pending','entryForUpload','id',code+';return publish;')(run,()=> 'changed',fs,{dirname:()=> 'work'},pending,()=>({basePath:'library_02',index:[{...entry}]}),'elle');
 await publish({allAnimationPreviews:{idle:{ready:true}}});
 assert.deepEqual(calls.filter(c=>c[0]==='add').map(c=>c.at(-1)),['work/a.mov','work/b.zip','work/b.zip','library_02/index.json']);
 assert.equal(pending.length,0);assert.deepEqual(Object.keys(written[0].allAnimationPreviews).sort(),['idle','other']);
 assert.ok(calls.filter(c=>c.includes('push')).every(c=>c.includes('http.version=HTTP/1.1')));
});
