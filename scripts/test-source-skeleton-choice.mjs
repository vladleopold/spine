import assert from 'node:assert/strict';
import { chooseSourceSkeleton } from './source-skeleton-choice.mjs';

const valid=new Set(['converted.json','legacy.json','wanted.json']);
const isValidJson=name=>valid.has(name);
assert.equal(
  chooseSourceSkeleton('illust_dating22_2.skel',
    ['illust_dating22_1.skel','illust_dating22_2.skel'],isValidJson),
  'illust_dating22_2.skel',
  'must select the exact skeleton named by the uploaded work, not the first file'
);
assert.equal(
  chooseSourceSkeleton('legacy.skel',['legacy.skel','legacy.json'],isValidJson),
  'legacy.json',
  'a verified converted JSON with the same skeleton name may replace its binary source'
);
assert.equal(
  chooseSourceSkeleton('castle_upgrade.json',
    ['castle_upgrade.json','castle_upgrade.skel'],isValidJson),
  'castle_upgrade.skel',
  'a byte-identical binary alias is used for a misnamed JSON source'
);
assert.equal(
  chooseSourceSkeleton('', ['other.skel','wanted.json'],isValidJson),
  'wanted.json',
  'when the upload did not specify a skeleton, choose a valid JSON skeleton first'
);
assert.equal(
  chooseSourceSkeleton('config.json',['config.json','player-main.json','player-main.atlas'],name=>name==='player-main.json'),
  'player-main.json',
  'a stale config.json skeleton pointer is repaired only when exactly one valid skeleton exists'
);
assert.throws(
  ()=>chooseSourceSkeleton('config.json',['config.json','player-main.json','other.skel'],name=>name==='player-main.json'),
  /Requested source skeleton is missing or invalid/,
  'ambiguous alternate skeletons must never be guessed'
);
assert.throws(
  ()=>chooseSourceSkeleton('missing.skel',['other.skel'],isValidJson),
  /Requested source skeleton is missing or invalid/,
  'never silently substitute another skeleton'
);
console.log('PASS source skeleton selection: exact upload file only; no sibling substitution');
