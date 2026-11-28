import assert from 'node:assert/strict';
import {reconcileSpineJsonAttachmentPaths} from './lib/spine-json-atlas-paths.mjs';

const atlas = [
  'Lilith.png',
  '\tsize: 2048,2048',
  '\tfilter: Linear,Linear',
  'back_hair',
  '\tbounds: 650,1215,108,78',
  'head',
  '\tbounds: 12,34,56,78',
].join('\n');
const source = {
  skeleton: {spine:'4.2.42'},
  skins: [{
    name:'default',
    attachments:{
      back_hair:{
        'new/back_hair':{type:'mesh',uvs:[0,1]},
      },
      head:{
        'new/head':{type:'mesh'},
      },
    },
  }],
};
const result = reconcileSpineJsonAttachmentPaths(JSON.stringify(source), atlas);
const parsed = JSON.parse(result.text);
assert.equal(result.aliases, 2);
assert.equal(parsed.skins[0].attachments.back_hair['new/back_hair'].path, 'back_hair');
assert.equal(parsed.skins[0].attachments.head['new/head'].path, 'head');
assert.deepEqual(parsed.skins[0].attachments.back_hair['new/back_hair'].uvs, [0,1]);

const exactSource = JSON.stringify({skins:[{name:'default',attachments:{slot:{
  'back_hair':{type:'region'},
}}}]});
const exact = reconcileSpineJsonAttachmentPaths(exactSource, atlas);
assert.equal(exact.aliases, 0);
assert.equal(JSON.parse(exact.text).skins[0].attachments.slot.back_hair.path, undefined);

const ambiguousAtlas = atlas + '\nother/back_hair\n\tbounds: 1,2,3,4';
const ambiguous = reconcileSpineJsonAttachmentPaths(JSON.stringify(source), ambiguousAtlas);
assert.equal(ambiguous.aliases, 1, 'only the unrelated unique head region may be rewritten');
const ambiguousParsed = JSON.parse(ambiguous.text);
assert.equal(ambiguousParsed.skins[0].attachments.back_hair['new/back_hair'].path, undefined);
assert.equal(ambiguousParsed.skins[0].attachments.head['new/head'].path, 'head');

console.log('PASS Spine JSON attachment paths reconcile only unique atlas-region basenames');
