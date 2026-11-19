import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {inspectAtlasSourceBundle} from './lib/atlas-source-integrity.mjs';
const root=fs.mkdtempSync(path.join(os.tmpdir(),'atlas-source-integrity-'));
function png(name,width,height){
  const b=Buffer.alloc(24);
  Buffer.from([137,80,78,71,13,10,26,10]).copy(b,0);
  b.writeUInt32BE(width,16);b.writeUInt32BE(height,20);
  fs.writeFileSync(path.join(root,name),b);
}
try{
  fs.writeFileSync(path.join(root,'hero.skel'),'fake fixture, never rendered');
  const atlasPath=path.join(root,'hero.atlas');
  png('hero.png',2048,2048);
  png('hero-two.png',2048,1024);
  const atlas='hero.png\nsize: 2048,2048\nformat: RGBA8888\n\n' +
              'hero-two.png\nsize: 2048,1024\nformat: RGBA8888\n';
  fs.writeFileSync(atlasPath,atlas);
  const complete=inspectAtlasSourceBundle(root,
    ['hero.skel','hero.atlas','hero.png','hero-two.png']);
  assert.deepEqual(complete,{complete:true,pages:2,unresolved:0,reason:'COMPLETE'});
  const missing=inspectAtlasSourceBundle(root,['hero.skel','hero.atlas','hero.png']);
  assert.equal(missing.complete,false);
  assert.equal(missing.reason,'ATLAS_PAGE_SOURCE_MISSING');
  assert.equal(missing.unresolved,1);
  fs.writeFileSync(atlasPath,atlas.replace('hero-two.png','exported-incorrect-page.png'));
  const dimensionRecovered=inspectAtlasSourceBundle(root,
    ['hero.skel','hero.atlas','hero.png','hero-two.png']);
  assert.equal(dimensionRecovered.complete,true);
  png('ambiguous.png',2048,1024);
  const ambiguity=inspectAtlasSourceBundle(root,
    ['hero.skel','hero.atlas','hero.png','hero-two.png','ambiguous.png']);
  assert.equal(ambiguity.complete,false);
  assert.equal(ambiguity.reason,'ATLAS_PAGE_SOURCE_MISSING');
  assert.equal(fs.readFileSync(atlasPath,'utf8'),
    atlas.replace('hero-two.png','exported-incorrect-page.png'),
    'validation must NEVER rewrite source atlas');
  fs.writeFileSync(atlasPath,atlas);
  const versionString=s=>Buffer.concat([Buffer.from([s.length+1]),Buffer.from(s)]);
  const trueBinary=Buffer.concat([versionString('hash'),versionString('3.8.75'),Buffer.alloc(32)]);
  fs.writeFileSync(path.join(root,'hero.json'),trueBinary);
  const correctlyRecognized=inspectAtlasSourceBundle(root,
    ['hero.json','hero.atlas','hero.png','hero-two.png']);
  assert.equal(correctlyRecognized.complete,true,'Binary Spine mislabeled JSON is a real source');
  const unsupported=Buffer.concat([versionString('hash'),versionString('3.8.75'),Buffer.alloc(32)]);
  fs.writeFileSync(path.join(root,'hero.json'),unsupported);
  const incompatible=inspectAtlasSourceBundle(root,
    ['hero.json','hero.atlas','hero.png','hero-two.png']);
  assert.equal(incompatible.complete,false);
  assert.equal(incompatible.reason,'UNSUPPORTED_SPINE_EXPORT_3_8_75');
  fs.writeFileSync(path.join(root,'hero.json'),'{garbled');
  const corrupt=inspectAtlasSourceBundle(root,
    ['hero.json','hero.atlas','hero.png','hero-two.png']);
  assert.equal(corrupt.complete,false,'Damaged JSON cannot impersonate Spine binary');
  console.log('PASS atlas source integrity: complete, missing, unique dimensions, ambiguous, immutable');
}finally{fs.rmSync(root,{recursive:true,force:true})}
