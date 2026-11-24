import path from "node:path";

// Spine 3.8's atlas reader predates the page-level pma flag. It treats
// that metadata line as a region name and then fails on the following region.
// Strip only this unsupported metadata for legacy runtimes; keep page names,
// region names, UVs and geometry byte-for-byte otherwise unchanged.
export function stripLegacyPmaMetadata(atlasText) {
  const lines=String(atlasText).split(/\\r?\\n/);
  let removed=0;
  const kept=lines.filter(line=>{
    if(/^[ \\t]*pma\\s*:/i.test(line)){removed++;return false;}
    return true;
  });
  return {text:kept.join("\\n"),removed};
}

export function chooseAtlasForSkeleton(skeletonName, atlasNames) {
  const stem=String(skeletonName||"").replace(/\.(json|skel)$/i,"").toLowerCase();
  const matches=atlasNames.filter(x=>/\.(atlas|atlas\.txt|atlas\.docx)$/i.test(x));
  const exact=matches.find(x=>x.replace(/\.atlas(?:\.txt|\.docx)?$/i,"").toLowerCase()===stem);
  if(exact)return exact;
  return matches.length===1?matches[0]:null;
}

// Edit only atlas PAGE names, never region names. Use exact filename match
// with .dds replaced by .png; never borrow a texture from another project.
export function reconcileDdsAtlasPages(atlasText, textureNames) {
  const available=new Map(textureNames.map(x=>[String(x).toLowerCase(),x]));
  const lines=atlasText.split(/\r?\n/);
  let aliases=0;
  for(let i=0;i+1<lines.length;i++){
    const name=lines[i].trim();
    if(!/\.dds$/i.test(name) ||
      !/^(size|format|filter|repeat|pma)\s*:/i.test(lines[i+1].trim()))continue;
    const replacement=available.get(path.basename(name.replace(/\\/g,"/")).replace(/\.dds$/i,".png").toLowerCase());
    if(replacement){lines[i]=replacement;aliases++;}
  }
  return {text:lines.join("\n"),aliases};
}


// Repair only the PAGE references in a genuine atlas, never its regions, UVs
// or image contents. Match exact case-insensitive basename first; then a
// uniquely matching PNG page dimension. One-page/one-texture bundles are
// unambiguous even when the exported page filename differs.
export function reconcileAtlasPageReferences(atlasText, textures) {
  const lines=String(atlasText).split(/\r?\n/);
  const items=Array.isArray(textures)?textures.filter(t=>t&&typeof t.name==='string'):[];
  const pages=[];
  for(let i=0;i+1<lines.length;i++){
    const name=lines[i].trim();
    if(!/\.(?:png|jpe?g|webp|dds)$/i.test(name)||
      !/^(?:size|format|filter|repeat|pma)\s*:/i.test(lines[i+1].trim()))continue;
    let width=0,height=0;
    for(let k=i+1;k<Math.min(lines.length,i+7);k++){
      const m=lines[k].trim().match(/^size:\s*(\d+)\s*,\s*(\d+)/i);
      if(m){width=Number(m[1]);height=Number(m[2]);break;}
      if(k>i+1 && !/^\w+\s*:/.test(lines[k].trim()))break;
    }
    pages.push({index:i,name,width,height});
  }
  const assigned=new Set();
  let aliases=0,unresolved=0;
  for(const page of pages){
    const filename=path.basename(page.name.replace(/\\/g,'/')).toLowerCase();
    let matches=items.filter(t=>!assigned.has(t.name)&&t.name.toLowerCase()===filename);
    if(matches.length!==1 && /\.dds$/i.test(filename)){
      const png=filename.replace(/\.dds$/i,'.png');
      matches=items.filter(t=>!assigned.has(t.name)&&t.name.toLowerCase()===png);
    }
    if(matches.length!==1&&page.width>0&&page.height>0){
      matches=items.filter(t=>!assigned.has(t.name)&&
        Number(t.width)===page.width&&Number(t.height)===page.height);
    }
    if(matches.length!==1&&pages.length===1&&items.length===1)
      matches=items;
    if(matches.length!==1){unresolved++;continue;}
    const match=matches[0];
    assigned.add(match.name);
    if(lines[page.index]!==match.name){lines[page.index]=match.name;aliases++;}
  }
  return {text:lines.join('\n'),aliases,unresolved,pages:pages.length};
}
