#!/usr/bin/env node
// Read-only acceptance of the ten newest public results. Only status counts
// are logged; proprietary filenames, pixels and media bytes are never printed.
const token=process.env.GITHUB_TOKEN||"";
const repo="vladleopold/spine";
const headers={"Accept":"application/vnd.github+json",...(token?{"Authorization":"Bearer "+token}:{})};
const path="library_02/index.json";
const url="https://api.github.com/repos/"+repo+"/contents/"+path+"?ref=main";
const indexResponse=await fetch(url,{headers,signal:AbortSignal.timeout(30000)});
if(!indexResponse.ok)throw Error("Cannot read current library metadata");
const payload=await indexResponse.json();
if(typeof payload.content!=="string")throw Error("No current library index");
const entries=JSON.parse(Buffer.from(payload.content.replace(/\n/g,""),"base64").toString("utf8"));
const top=entries.filter(e=>/^Spine-animation-/.test(e.id||""))
  .sort((a,b)=>Date.parse(b.uploadedAt||0)-Date.parse(a.uploadedAt||0)).slice(0,10);
if(top.length!==10)throw Error("Latest 10 library records unavailable");
const magic=(bytes,kind)=>{
  if(kind==="webm")return bytes.length>=4&&bytes[0]===0x1a&&bytes[1]===0x45&&bytes[2]===0xdf&&bytes[3]===0xa3;
  return bytes.length>=12&&String.fromCharCode(...bytes.slice(0,4))==="RIFF"&&
    String.fromCharCode(...bytes.slice(8,12))==="WEBP";
};
async function probe(url,kind){
  if(!/^https:\/\/spine-link\.vercel\.app\/assets\//.test(url))return false;
  for(let attempt=1;attempt<=4;attempt++){
    try{
      const response=await fetch(url,{headers:{"Range":"bytes=0-32767","Cache-Control":"no-cache"},
        signal:AbortSignal.timeout(30000)});
      if(response.ok){
        const bytes=new Uint8Array(await response.arrayBuffer());
        if(magic(bytes,kind))return true;
      }
    }catch{}
    await new Promise(resolve=>setTimeout(resolve,attempt*3000));
  }
  return false;
}
let ready=0,blocked=0,failed=0,selected=0;
for(const item of top){
  if(item.webmStatus==="blocked-missing-source"){blocked++;continue;}
  if(item.webmStatus!=="ready"){failed++;continue;}
  const video=String(item.webmPreview||"");
  const poster=String(item.webpPoster||item.thumbnailPoster||"");
  const [videoOk,posterOk]=await Promise.all([probe(video,"webm"),probe(poster,"webp")]);
  if(!videoOk||!posterOk){failed++;continue;}
  if(item.id==="Spine-animation-2026-11-17T18-45-14-132Z"){
    const preview=item.allAnimationPreviews?.["Idle Post Climax Cum"];
    if(!preview||!await probe(String(preview.webmPreview||""),"webm")){failed++;continue;}
    selected++;
  }
  ready++;
}
console.log("PRODUCTION_LAST10_MEDIA_AUDIT="+JSON.stringify({total:10,ready,blocked,failed,selectedAnimationVerified:selected}));
if(failed||ready+blocked!==10||selected!==1)
  throw Error("Real production preview acceptance failed");
