import fs from "node:fs";
import path from "node:path";
import {PNG} from "pngjs";
const id="boss_1-2026-11-14T20-07-17-943Z",dir=path.join("library_02",id);
const sk=JSON.parse(fs.readFileSync(path.join(dir,"boss_1.json"),"utf8"));
const im=PNG.sync.read(fs.readFileSync(path.join(dir,"boss_1.png")));
const {width:w,height:h,data}=im;
const binary=new Uint8Array(w*h);
let alpha=0,alphaFull=0;
for(let i=0;i<w*h;i++) {const a=data[i*4+3];if(a>8){binary[i]=1;alpha++;}if(a===255)alphaFull++;}
const seen=new Uint8Array(w*h), comps=[];
const coords=[-1,0,1];
for(let i=0;i<binary.length;i++){
 if(!binary[i]||seen[i])continue;
 const stack=[i];seen[i]=1;
 let xmin=w,xmax=0,ymin=h,ymax=0,n=0;
 while(stack.length){
  const p=stack.pop();const y=Math.floor(p/w),x=p%w;n++;
  if(x<xmin)xmin=x;if(x>xmax)xmax=x;if(y<ymin)ymin=y;if(y>ymax)ymax=y;
  for(const dx of coords)for(const dy of coords){
   if(!dx&&!dy)continue;
   const nx=x+dx,ny=y+dy;if(nx<0||ny<0||nx>=w||ny>=h)continue;
   const j=ny*w+nx;if(binary[j]&&!seen[j]){seen[j]=1;stack.push(j);}
  }
 }
 comps.push({x:xmin,y:ymin,w:xmax-xmin+1,h:ymax-ymin+1,pixels:n});
}
let attaches=[];
const skins=Array.isArray(sk.skins)
  ? sk.skins.map(s=>s.attachments||{})
  : Object.values(sk.skins||{});
for(const skin of skins){
 for(const [slot,entries] of Object.entries(skin))
 for(const [name,a] of Object.entries(entries)){
  if(a.type==="boundingbox")continue;
  attaches.push({type:a.type||"region",name:a.name||name,dimension:[Math.round(a.width||0),Math.round(a.height||0)],uvs:a.uvs?.length||0,vertices:a.vertices?.length||0});
 }
}
const dims=attaches.filter(x=>x.dimension.every(y=>y>0));
const big=comps.filter(x=>x.pixels>=15);
console.log(JSON.stringify({
 dimensions:[w,h],alphaPercent:Math.round(alpha/w/h*100),solidPercent:Math.round(alphaFull/w/h*100),
 totalComponents:comps.length,components15:big.length,
 componentSizes:big.sort((a,b)=>b.pixels-a.pixels).slice(0,45).map(x=>[x.w,x.h,x.pixels]),
 attachmentCount:attaches.length,regionCount:attaches.filter(x=>x.type==="region").length,
 skinnedMeshCount:attaches.filter(x=>x.type==="skinnedmesh").length,
 dimensionsAvailable:dims.length,
 attachmentSizes:dims.map(x=>[x.type,x.dimension[0],x.dimension[1]]),
 title:"Only private image geometry metrics, no pixels",
},null,2));
