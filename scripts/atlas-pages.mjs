import path from "node:path";

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
