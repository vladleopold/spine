import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {prepareBinaryJsonSkeletonAliases} from './lib/spine-binary-json-alias.mjs';
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'spine-binary-json-alias-'));
function variable(n){const out=[];while(n>=128){out.push((n&127)|128);n>>>=7;}out.push(n);return Buffer.from(out);}
function string(s){const b=Buffer.from(s);return Buffer.concat([variable(b.length+1),b]);}
try{
  const atlas=path.join(temp,'character.atlas');
  fs.writeFileSync(atlas,'character.png\nsize: 16,16\nformat: RGBA8888\n');
  fs.writeFileSync(path.join(temp,'character.png'),Buffer.from('source texture unchanged'));
  const raw=Buffer.concat([string('authentic hash'),string('3.8.75'),Buffer.alloc(32,0)]);
  const original=path.join(temp,'character.json');
  const alias=path.join(temp,'character.skel');
  fs.writeFileSync(original,raw);
  const cleanup=prepareBinaryJsonSkeletonAliases(temp);
  assert.equal(fs.existsSync(alias),true);
  assert.deepEqual(fs.readFileSync(alias),raw,'binary alias must be byte-identical');
  assert.deepEqual(fs.readFileSync(original),raw,'original binary-named-JSON must stay unchanged');
  cleanup();
  assert.equal(fs.existsSync(alias),false,'alias must be deleted after rendering');
  fs.writeFileSync(original,'{invalid json');
  const cleanupBroken=prepareBinaryJsonSkeletonAliases(temp);
  assert.equal(fs.existsSync(alias),false,'broken JSON must not be mistaken for valid binary');
  cleanupBroken();
  fs.writeFileSync(original,JSON.stringify({skeleton:{spine:'4.1.24'},bones:[]}));
  const cleanupValid=prepareBinaryJsonSkeletonAliases(temp);
  assert.equal(fs.existsSync(alias),false,'valid JSON is never aliased');
  cleanupValid();
  console.log('PASS binary JSON import: true 3.8 alias only, untouched source, cleanup, corrupt JSON fail-closed');
}finally{fs.rmSync(temp,{recursive:true,force:true});}
