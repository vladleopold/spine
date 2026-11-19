import fs from 'node:fs';
import path from 'node:path';
import {detectBinarySpineVersion} from '../spine-version-detect.mjs';
import {chooseAtlasForSkeleton} from '../atlas-pages.mjs';

// Preview-only file alias: preserve the uploaded bytes and filename. Some
// external exporters call a real binary .skel file "character.json". Never
// parse it as JSON or rename/delete the original repository source.
// The alias is removed synchronously when the render subprocess exits.
export function prepareBinaryJsonSkeletonAliases(baseDir, maxDepth=5){
  const temporary=[];
  const base=path.resolve(baseDir);
  function visit(dir,depth){
    if(depth>maxDepth)return;
    const items=fs.readdirSync(dir,{withFileTypes:true});
    const names=items.filter(e=>e.isFile()).map(e=>e.name);
    const atlases=names.filter(name=>/\.atlas(?:\.txt|\.docx)?$/i.test(name));
    for(const name of names.filter(n=>/\.json$/i.test(n))){
      const original=path.join(dir,name);
      const alias=path.join(dir,name.replace(/\.json$/i,'.skel'));
      if(fs.existsSync(alias)||!chooseAtlasForSkeleton(name,atlases))continue;
      let version='unknown';
      try{
        const fd=fs.openSync(original,'r');
        try{
          const sample=Buffer.alloc(512);
          const count=fs.readSync(fd,sample,0,sample.length,0);
          const header=sample.subarray(0,count);
          // Genuine JSON starts with an object/array; damaged JSON must
          // remain an error, not be mistaken for a valid binary skeleton.
          const first=header.toString('latin1').trimStart().charAt(0);
          if(first==='{'||first==='[')continue;
          version=detectBinarySpineVersion(header);
        }finally{fs.closeSync(fd);}
        if(version==='unknown')continue;
        fs.copyFileSync(original,alias,fs.constants.COPYFILE_EXCL);
        temporary.push(alias);
        console.error('MISLABELED_SPINE_BINARY_ALIAS_CREATED version='+version);
      }catch(error){
        if(error?.code==='EEXIST')continue;
        // A bad source is not permission to create a replacement timeline.
        console.error('MISLABELED_SPINE_BINARY_ALIAS_FAILED');
      }
    }
    for(const e of items.filter(e=>e.isDirectory()&&
      !e.name.endsWith('.__chunks')&&e.name!=='animations'))
      visit(path.join(dir,e.name),depth+1);
  }
  visit(base,0);
  return ()=>{for(const file of temporary)try{fs.rmSync(file,{force:true})}catch{}};
}
