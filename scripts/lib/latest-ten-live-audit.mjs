const blockedReasons=new Set([
  "MISSING_DEFAULT_ANIMATION",
  "MISSING_SOURCE_TRIAD",
  "INCOMPATIBLE_SOURCE_VERSION",
]);
const media=[
  {name:"preview.webm",kind:"webm"},
  {name:"preview-medium.webm",kind:"webm"},
  {name:"preview-low.webm",kind:"webm"},
  {name:"preview.webp",kind:"webp"},
  {name:"preview-medium.webp",kind:"webp"},
  {name:"preview-low.webp",kind:"webp"},
];

function safePreviewPath(value){
  const parts=String(value||"").split("/");
  if(parts.length<2||!/^library(?:_\d+)?$/.test(parts[0]))return null;
  if(parts.some(part=>!part||part==="."||part===".."||
    !/^[a-z0-9][a-z0-9._-]{0,200}$/i.test(part)))return null;
  return parts;
}

function hasMagic(bytes,kind){
  if(kind==="webm")
    return bytes.length>=4&&bytes[0]===0x1a&&bytes[1]===0x45&&bytes[2]===0xdf&&bytes[3]===0xa3;
  return bytes.length>=12&&String.fromCharCode(...bytes.slice(0,4))==="RIFF"&&
    String.fromCharCode(...bytes.slice(8,12))==="WEBP";
}

const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));

async function probe(fetchImpl,url,kind,retries,delayMs){
  for(let attempt=0;attempt<retries;attempt++){
    try{
      const response=await fetchImpl(url,{
        headers:{"Range":"bytes=0-32767","Cache-Control":"no-cache"},
        signal:AbortSignal.timeout(30000),
      });
      if(response.ok){
        const bytes=new Uint8Array(await response.arrayBuffer());
        if(hasMagic(bytes,kind))return true;
      }
    }catch{}
    if(attempt+1<retries&&delayMs>0)await sleep(delayMs*(attempt+1));
  }
  return false;
}

export async function auditLatestTen(items,fetchImpl=globalThis.fetch,options={}){
  if(!Array.isArray(items)||items.length!==10)
    throw new Error("Expected the exact ten-entry inventory manifest");
  if(typeof fetchImpl!=="function")throw new Error("Media fetch is unavailable");
  const retries=Number.isInteger(options.retries)&&options.retries>0?options.retries:4;
  const delayMs=Number.isFinite(options.delayMs)&&options.delayMs>=0?options.delayMs:3000;
  let ready=0,blocked=0,failed=0;
  for(const item of items){
    const parts=safePreviewPath(item?.previewPath);
    if(!item||typeof item.id!=="string"||
      !/^[a-z0-9][a-z0-9._-]{0,200}$/i.test(item.id)||
      !parts||item.basePath!==parts[0]){
      failed++;
      continue;
    }
    if(item.ready!==true){
      if(blockedReasons.has(item.blockedReason))blocked++;
      else failed++;
      continue;
    }
    if(typeof item.animation!=="string"||!item.animation.trim()){
      failed++;
      continue;
    }
    const prefix="https://spine-link.vercel.app/assets/"+
      parts.map(encodeURIComponent).join("/")+"/";
    const checks=await Promise.all(media.map(asset=>
      probe(fetchImpl,prefix+asset.name,asset.kind,retries,delayMs)));
    if(checks.every(Boolean))ready++;
    else failed++;
  }
  return {total:items.length,ready,blocked,failed};
}
