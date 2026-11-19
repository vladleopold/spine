import fs from 'node:fs';
import path from 'node:path';
import {chooseAtlasForSkeleton,reconcileAtlasPageReferences} from '../atlas-pages.mjs';

// Validate the REAL atlas page inventory. A skeleton+atlas+one PNG is not
// necessarily a complete Spine export: an atlas can demand more image pages.
function readPngSize(filename){
  const fd=fs.openSync(filename,'r');
  try{
    const bytes=Buffer.alloc(24);
    if(fs.readSync(fd,bytes,0,bytes.length,0)!==24 ||
       !bytes.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])))
      return {width:0,height:0};
    return {width:bytes.readUInt32BE(16),height:bytes.readUInt32BE(20)};
  }finally{fs.closeSync(fd);}
}

export function inspectAtlasSourceBundle(directory, filenames){
  const files=Array.isArray(filenames)?filenames:[];
  const skeleton=files.find(name=>/\.json$/i.test(name)&&(()=>{
    try{return Array.isArray(JSON.parse(fs.readFileSync(path.join(directory,name),'utf8')).bones)}
    catch{return false}
  })())||files.find(name=>/\.skel$/i.test(name));
  const atlas=skeleton?chooseAtlasForSkeleton(skeleton,files):'';
  const textures=files.filter(name=>/\.(png|webp|jpe?g|dds)$/i.test(name));
  if(!skeleton||!atlas||textures.length===0)
    return {complete:false,pages:0,unresolved:0,reason:'MISSING_SOURCE_TRIAD'};
  try{
    const info=textures.map(name=>{
      let size={width:0,height:0};
      try{if(/\.png$/i.test(name))size=readPngSize(path.join(directory,name))}catch{}
      return {name,...size};
    });
    const raw=fs.readFileSync(path.join(directory,atlas),'utf8');
    const pages=reconcileAtlasPageReferences(raw,info);
    if(pages.pages<1)
      return {complete:false,pages:pages.pages,unresolved:0,reason:'ATLAS_PAGE_INVENTORY_UNKNOWN'};
    if(pages.unresolved>0)
      return {complete:false,pages:pages.pages,unresolved:pages.unresolved,reason:'ATLAS_PAGE_SOURCE_MISSING'};
    return {complete:true,pages:pages.pages,unresolved:0,reason:'COMPLETE'};
  }catch{
    return {complete:false,pages:0,unresolved:0,reason:'ATLAS_SOURCE_UNREADABLE'};
  }
}
