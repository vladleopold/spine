/** Reconstruct a candidate legacy Spine atlas from PNG alpha islands and JSON.
 * Never invents source image pixels. Inference is labelled and confidence-scored.
 */
const leaf=s=>String(s||"").replace(/\\/g,"/").split("/").pop();
function renderable(json){
  const skins=Array.isArray(json?.skins)?json.skins.map(s=>s.attachments||{}):Object.values(json?.skins||{});
  const names=new Map();
  for(const skin of skins)for(const items of Object.values(skin))
    for(const [key,a] of Object.entries(items||{})){
      if(!a||["boundingbox","clipping","path"].includes(a.type))continue;
      const name=String(a.path||a.name||key).trim(),id=name.toLowerCase();
      if(name&&!names.has(id))names.set(id,{name,width:Number(a.width)||0,height:Number(a.height)||0,type:a.type||"region"});
    }
  return [...names.values()];
}
function alphaIslands(data,w,h,minPixels=10){
  if(!data||data.length!==w*h*4||w<1||h<1||w*h>16*1024*1024)throw Error("Invalid RGBA input");
  const seen=new Uint8Array(w*h),regions=[];
  for(let p=0;p<w*h;p++){
    if(seen[p]||data[p*4+3]<9)continue;
    seen[p]=1;
    const stack=[p];let x0=w,x1=0,y0=h,y1=0,n=0;
    while(stack.length){
      const id=stack.pop(),x=id%w,y=(id-x)/w;n++;
      x0=Math.min(x,x0);x1=Math.max(x,x1);y0=Math.min(y,y0);y1=Math.max(y,y1);
      for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){
        if(!dx&&!dy)continue;
        const xx=x+dx,yy=y+dy;
        if(xx<0||yy<0||xx>=w||yy>=h)continue;
        const q=yy*w+xx;
        if(!seen[q]&&data[q*4+3]>=9){seen[q]=1;stack.push(q);}
      }
    }
    if(n>=minPixels)regions.push({x:x0,y:y0,w:x1-x0+1,h:y1-y0+1,pixels:n});
  }
  return regions.sort((a,b)=>b.pixels-a.pixels);
}
function matchScore(a,b,scale){
  if(!a.width||!a.height)return {score:0,rotate:false};
  const w=a.width*scale,h=a.height*scale;
  const normal=Math.abs(Math.log(b.w/w))+Math.abs(Math.log(b.h/h));
  const rotated=Math.abs(Math.log(b.w/h))+Math.abs(Math.log(b.h/w));
  return {score:Math.exp(-6*Math.min(normal,rotated)),rotate:rotated+.001<normal};
}
function assign(scores){
  const n=scores.length,m=scores[0]?.length||0;if(!n)return [];
  const u=new Float64Array(n+1),v=new Float64Array(m+1),p=new Int32Array(m+1),way=new Int32Array(m+1);
  for(let i=1;i<=n;i++){
    p[0]=i;const minv=new Float64Array(m+1);minv.fill(Infinity);
    const used=new Uint8Array(m+1);let j0=0;
    do{
      used[j0]=1;
      const i0=p[j0],row=scores[i0-1];let delta=Infinity,j1=0;
      for(let j=1;j<=m;j++)if(!used[j]){
        const cur=-row[j-1]-u[i0]-v[j];
        if(cur<minv[j]){minv[j]=cur;way[j]=j0;}
        if(minv[j]<delta){delta=minv[j];j1=j;}
      }
      for(let j=0;j<=m;j++)if(used[j]){u[p[j]]+=delta;v[j]-=delta;}
      else if(j)minv[j]-=delta;
      j0=j1;
    }while(p[j0]);
    do{const j1=way[j0];p[j0]=p[j1];j0=j1;}while(j0);
  }
  const result=new Array(n).fill(-1);
  for(let j=1;j<=m;j++)if(p[j])result[p[j]-1]=j-1;
  return result;
}
function fitted(attach,boxes,scale){
  const matrix=attach.map(a=>[...boxes.map(b=>matchScore(a,b,scale).score),...Array(attach.length).fill(0.115)]);
  const mapping=assign(matrix);
  const matches=mapping.map((i,j)=>{
    const box=i>=0&&i<boxes.length?boxes[i]:null;
    const score=box?matchScore(attach[j],box,scale):{score:0,rotate:false};
    return {...attach[j],box,score:score.score,rotate:score.rotate};
  });
  const good=matches.filter(x=>x.score>=0.7);
  const area=boxes.reduce((s,x)=>s+x.pixels,0);
  return {scale,matches,confident:good.length,
    quality:matches.reduce((s,x)=>s+x.score,0)/matches.length,
    coverage:area?good.reduce((s,x)=>s+x.box.pixels,0)/area:0};
}
function pageHeader(image){
  return [image.name,"size: "+image.width+","+image.height,
    "format: RGBA8888","filter: Linear,Linear","repeat: none"];
}
function addRegion(lines,a){
  const b=a.box||{x:0,y:0,w:1,h:1};
  const w=a.rotate?b.h:b.w,h=a.rotate?b.w:b.h;
  lines.push("",a.name,"  rotate: "+(a.rotate?"true":"false"),
    "  xy: "+b.x+","+b.y,"  size: "+w+","+h,
    "  orig: "+w+","+h,"  offset: 0,0","  index: -1");
}
export function reconstructAtlas(skeleton,images,{strict=false}={}){
  const attachments=renderable(skeleton);
  if(!attachments.length)throw Error("No renderable attachments");
  if(!Array.isArray(images)||!images.length)throw Error("No PNG pages");
  const pages=images.map(x=>({...x,name:leaf(x.name)}));
  for(const page of pages)if(!/^[^/\\]+\.(?:png|jpg|jpeg|webp)$/i.test(page.name)||
    !page.width||!page.height)throw Error("Unsafe or dimensionless page");
  const named=new Map(pages.map(x=>[x.name.toLowerCase().replace(/\.(png|jpe?g|webp)$/i,""),x]));
  if(pages.length>1&&attachments.every(x=>named.has(leaf(x.name).toLowerCase()))){
    const lines=[];
    for(const page of pages){
      lines.push(...pageHeader(page));
      for(const a of attachments.filter(x=>named.get(leaf(x.name).toLowerCase())===page))
        addRegion(lines,{...a,rotate:false,box:{x:0,y:0,w:page.width,h:page.height}});
      lines.push("");
    }
    return {text:lines.join("\n")+"\n",kind:"named-pages",confidence:1,coverage:1,matched:attachments.length,total:attachments.length,inferred:false,scale:1};
  }
  if(pages.length!==1)throw Error("Ambiguous source images without filenames matching JSON attachments");
  const page=pages[0],boxes=alphaIslands(page.rgba,page.width,page.height);
  if(!boxes.length)throw Error("Packed texture has no visible parts");
  const scales=[.25,.333333,.375,.4,.45,.475,.5,.525,.55,.6,.625,.75,1,1.25,1.5,2];
  const fits=scales.map(s=>fitted(attachments,boxes,s)).sort((a,b)=>
    (b.confident*1.8+b.quality+.9*b.coverage)-(a.confident*1.8+a.quality+.9*a.coverage));
  const best=fits[0];
  if(strict&&(best.confident!==attachments.length||best.coverage<.92))
    throw Error("Atlas inference cannot meet strict visual-geometry threshold");
  const lines=pageHeader(page);
  for(const item of best.matches)addRegion(lines,item);
  return {text:lines.join("\n")+"\n",kind:"inferred-packed-sheet",
    confidence:Number(best.quality.toFixed(4)),coverage:Number(best.coverage.toFixed(4)),
    matched:best.confident,total:attachments.length,inferred:true,scale:best.scale,
    regions:best.matches.map(x=>({name:x.name,score:Number(x.score.toFixed(4)),
      rotated:x.rotate,box:x.box?{x:x.box.x,y:x.box.y,w:x.box.w,h:x.box.h}:null}))};
}
