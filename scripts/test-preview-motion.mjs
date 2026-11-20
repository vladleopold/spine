import assert from 'node:assert/strict';
import {execFileSync} from 'node:child_process';
import {mkdtempSync,rmSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {fileURLToPath} from 'node:url';

const verifier=fileURLToPath(new URL('./verify-preview-motion.mjs',import.meta.url));
const dir=mkdtempSync(join(tmpdir(),'spine-preview-motion-'));
function render(name,source,filter){
  const output=join(dir,name+'.nut');
  const args=['-v','error','-f','lavfi','-i',source];
  if(filter)args.push('-vf',filter);
  args.push('-c:v','rawvideo','-pix_fmt','gray','-f','nut','-y',output);
  execFileSync('ffmpeg',args,{stdio:'ignore',timeout:30000});
  return output;
}
function passes(file){
  execFileSync(process.execPath,[verifier,file],{stdio:'ignore'});
}
function rejects(file){
  assert.throws(()=>execFileSync(process.execPath,[verifier,file],{stdio:'ignore'}));
}
try{
  const moving=render('moving','color=c=black:s=64x64:r=10:d=1',
    "format=gray,geq=lum='if(lt(abs(X-(mod(N*5,48)+6)),6)*lt(abs(Y-32),6),255,0)'");
  const seven=render('seven','color=c=black:s=64x64:r=10:d=1',
    "format=gray,geq=lum='if(lt(N,7)*lt(abs(X-(mod(N*5,48)+6)),6)*lt(abs(Y-32),6),255,0)'");
  const staticClip=render('static','color=c=white:s=64x64:r=10:d=1',null);
  const blank=render('blank','color=c=black:s=64x64:r=10:d=1',null);
  passes(moving);
  rejects(seven);
  rejects(staticClip);
  rejects(blank);
  console.log('PASS preview motion: >=8 nonzero distinct frames; static and blank clips rejected');
}finally{
  rmSync(dir,{recursive:true,force:true});
}
