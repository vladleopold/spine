import test from 'node:test';
import assert from 'node:assert/strict';
import { parseAtlasPages, summarizeSkeleton, buildProjectEntry } from '../scripts/build-sa-reference-index.mjs';
const skeleton={skeleton:{spine:'4.3.26'},bones:[{name:'root'}],slots:[{name:'body',bone:'root'}],
 skins:[{name:'default',attachments:{body:{body:{type:'mesh',bones:[1,0,0,1],vertices:[0,0,1,1],triangles:[0,0,0]}}}}],
 ik:[{name:'leg'}],transform:[],path:[],physics:[],animations:{idle:{bones:{root:{rotate:[{time:0,angle:0},{time:1,angle:90}]}}}}};
test('atlas parser reads page names only from page headers',()=>{
 assert.deepEqual(parseAtlasPages('page.png\nsize: 128, 128\nformat: RGBA8888\n\nregion\n  rotate: false\nother.webp\nsize: 64, 64'),['page.png','other.webp']);
});
test('skeleton summary captures rig, constraints, attachments and clips',()=>{
 const x=summarizeSkeleton(skeleton);assert.equal(x.spineVersion,'4.3.26');assert.equal(x.boneCount,1);
 assert.equal(x.slotCount,1);assert.equal(x.ikConstraintCount,1);assert.equal(x.meshCount,1);
 assert.equal(x.weightedMeshCount,1);assert.deepEqual(x.animations,['idle']);assert.equal(x.keyframeCount,2);
});
test('reference entry never exports uploader identity and never assumes training rights',()=>{
 const files=['library_01/demo-2026-01-01T00-00-00-000Z/skeleton.json',
  'library_01/demo-2026-01-01T00-00-00-000Z/skeleton.atlas',
  'library_01/demo-2026-01-01T00-00-00-000Z/images/body.png',
  'library_01/demo-2026-01-01T00-00-00-000Z/preview.webm',
  'library_01/demo-2026-01-01T00-00-00-000Z/source-proof.json',
  'library_01/demo-2026-01-01T00-00-00-000Z/blockchain-anchor.json'];
 const values={
  [files[0]]:JSON.stringify(skeleton),[files[1]]:'images/body.png\nsize: 64, 64\nformat: RGBA8888',
  [files[4]]:JSON.stringify({title:'Demo character',uploadedAt:'2026-01-01T00:00:00.000Z',uploader:{anonymousAccountId:'secret-user'}})
 };
 const entry=buildProjectEntry({collection:'library_01',id:'demo-2026-01-01T00-00-00-000Z',
  files,commit:'a'.repeat(40),readFile:p=>values[p]||null});
 assert.equal(entry.title,'demo');assert.equal(entry.summary.boneCount,1);
 assert.equal(entry.projectCompleteness,'complete');assert.equal(entry.previewUrl.includes('preview.webm'),true);
 assert.equal(entry.rights.trainingEligible,false);assert.equal(entry.rights.sourceReuseAllowed,false);
 assert.equal(JSON.stringify(entry).includes('secret-user'),false);
});
