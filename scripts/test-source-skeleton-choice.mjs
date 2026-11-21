import assert from 'node:assert/strict';
import { chooseSourceSkeleton } from './source-skeleton-choice.mjs';

const valid=new Set([
  'converted.json','legacy.json','wanted.json','first.json','second.json',
  'alias.json','WANTED.JSON',
]);
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
  chooseSourceSkeleton('https://example.invalid/assets/Target%20Rig.skel?v=3',
    ['Target Rig.skel'],isValidJson),
  'Target Rig.skel',
  'URL-encoded index paths must resolve to the same exact source filename'
);

assert.throws(
  ()=>chooseSourceSkeleton('', ['other.skel','wanted.json'],isValidJson),
  /Source skeleton is ambiguous/,
  'a valid JSON file must not win merely because it appears before or after another skeleton'
);
assert.equal(
  chooseSourceSkeleton('', ['wanted.json'],isValidJson),
  'wanted.json',
  'a sole valid JSON skeleton is unambiguous'
);
assert.equal(
  chooseSourceSkeleton('', ['only.skel'],isValidJson),
  'only.skel',
  'a sole binary skeleton is unambiguous'
);
assert.equal(
  chooseSourceSkeleton('', ['alias.skel','alias.json'],isValidJson),
  'alias.json',
  'a same-stem valid JSON conversion and binary alias represent one source identity'
);
assert.throws(
  ()=>chooseSourceSkeleton('', ['first.json','second.skel'],isValidJson),
  /Source skeleton is ambiguous/,
  'different skeleton identities require explicit index metadata'
);
assert.throws(
  ()=>chooseSourceSkeleton('', ['first.json','second.json'],isValidJson),
  /Source skeleton is ambiguous/,
  'multiple valid JSON skeletons must not be selected by directory order'
);
assert.throws(
  ()=>chooseSourceSkeleton('', ['one.skel','two.skel'],isValidJson),
  /Source skeleton is ambiguous/,
  'multiple binary skeletons must not be selected by directory order'
);
assert.throws(
  ()=>chooseSourceSkeleton('wanted.skel',['wanted.skel','wanted.json','WANTED.JSON'],isValidJson),
  /Source skeleton is ambiguous/,
  'multiple same-stem converted JSON candidates must not select the first'
);
assert.throws(
  ()=>chooseSourceSkeleton('castle_upgrade.json',
    ['castle_upgrade.skel','CASTLE_UPGRADE.skel'],isValidJson),
  /Source skeleton is ambiguous/,
  'multiple same-stem binary aliases must not select the first'
);
assert.throws(
  ()=>chooseSourceSkeleton('missing.skel',['other.skel'],isValidJson),
  /Requested source skeleton is missing or invalid/,
  'never silently substitute another skeleton'
);

console.log('PASS source skeleton selection: exact identity only; ambiguous directories fail closed');
