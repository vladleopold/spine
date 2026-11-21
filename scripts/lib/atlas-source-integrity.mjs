import fs from 'node:fs';
import path from 'node:path';
import {chooseAtlasForSkeleton,reconcileAtlasPageReferences} from '../atlas-pages.mjs';
import {detectBinarySpineVersion} from '../spine-version-detect.mjs';

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
    try{
      const bytes=fs.readFileSync(path.join(directory,name));
      // Valid JSON skeleton, or a genuine binary Spine header accidentally
      // uploaded under a JSON extension. Do not accept damaged JSON.
      try{return Array.isArray(JSON.parse(bytes.toString('utf8')).bones)}
      catch{
        if(/^[\s]*[\[{]/.test(bytes.subarray(0,32).toString('latin1')))return false;
        return detectBinarySpineVersion(bytes.subarray(0,512))!=='unknown';
      }
    }catch{return false}
  })())||files.find(name=>/\.skel$/i.test(name));
  // Spine 3.8.75 shipped a deprecated export format that official 3.8
  // runtimes explicitly reject. Do not forge a different version string
  // or fabricate video from another animation for an incompatible source.
  if(skeleton){
    try{
      const raw=fs.readFileSync(path.join(directory,skeleton));
      let version='unknown';
      if(/\.json$/i.test(skeleton)){
        try{version=String(JSON.parse(raw.toString('utf8'))?.skeleton?.spine||'unknown');}
        catch{version=detectBinarySpineVersion(raw.subarray(0,512));}
      }else version=detectBinarySpineVersion(raw.subarray(0,512));
      if(version==='3.8.75')
        return {complete:false,pages:0,unresolved:0,reason:'UNSUPPORTED_SPINE_EXPORT_3_8_75'};
    }catch{}
  }
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
