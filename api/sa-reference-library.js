import fs from 'node:fs';
import path from 'node:path';

const ALLOWED_ORIGINS=new Set([
 'https://spineanimator.github.io','https://spineanimator.dev',
 'https://www.spineanimator.dev','https://spine-link.vercel.app'
]);
function safeInt(value,fallback,min,max){const n=Number(value);return Number.isInteger(n)?Math.max(min,Math.min(max,n)):fallback;}
function publicEntry(entry){
 return {
  id:entry.id,title:entry.title,collection:entry.collection,projectPath:entry.projectPath,
  uploadedAt:entry.uploadedAt,sourceRepository:entry.sourceRepository,sourceCommit:entry.sourceCommit,
  skeletonPath:entry.skeletonPath,atlasPath:entry.atlasPath,texturePaths:entry.texturePaths,
  atlasPageCount:entry.atlasPageCount,hasAllAtlasTextures:entry.hasAllAtlasTextures,
  skeletonSha256:entry.skeletonSha256,atlasSha256:entry.atlasSha256,summary:entry.summary,
  previews:entry.previews,previewUrl:entry.previewUrl,posterUrl:entry.posterUrl,
  projectCompleteness:entry.projectCompleteness,rights:entry.rights,review:entry.review
 };
}
export default async function handler(request,response){
 const origin=String(request.headers.origin||'');
 if(origin&&!ALLOWED_ORIGINS.has(origin))return response.status(403).json({error:'ORIGIN_FORBIDDEN'});
 if(origin){response.setHeader('Access-Control-Allow-Origin',origin);response.setHeader('Vary','Origin');}
 response.setHeader('Cache-Control','public, max-age=60, s-maxage=300, stale-while-revalidate=3600');
 response.setHeader('X-Content-Type-Options','nosniff');
 if(request.method==='OPTIONS'){
  response.setHeader('Access-Control-Allow-Methods','GET, HEAD, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers','Content-Type');
  return response.status(204).end();
 }
 if(!['GET','HEAD'].includes(request.method)){response.setHeader('Allow','GET, HEAD, OPTIONS');return response.status(405).json({error:'METHOD_NOT_ALLOWED'});}
 const indexPath=path.join(process.cwd(),'public','sa-reference-index.json');
 if(!fs.existsSync(indexPath))return response.status(503).json({error:'REFERENCE_INDEX_NOT_BUILT'});
 let index;
 try{index=JSON.parse(fs.readFileSync(indexPath,'utf8'));}catch{return response.status(503).json({error:'REFERENCE_INDEX_INVALID'});}
 if(index?.schema!=='sa.reference-library-index'||index.version!==1||!Array.isArray(index.projects))
  return response.status(503).json({error:'REFERENCE_INDEX_INVALID'});
 const q=String(request.query?.q||'').trim().toLowerCase().slice(0,180);
 const animation=String(request.query?.animation||'').trim().toLowerCase().slice(0,120);
 const spineVersion=String(request.query?.spineVersion||'').trim().slice(0,32);
 const minBones=safeInt(request.query?.minBones,0,0,10000);
 const minSlots=safeInt(request.query?.minSlots,0,0,10000);
 const hasPreview=request.query?.hasPreview==='true';
 const limit=safeInt(request.query?.limit,20,1,100);
 const offset=safeInt(request.query?.offset,0,0,1000000);
 const terms=q.split(/\s+/).filter(Boolean);
 const matches=index.projects.filter(entry=>{
  if(spineVersion&&entry.summary?.spineVersion!==spineVersion)return false;
  if(minBones&&(entry.summary?.boneCount||0)<minBones)return false;
  if(minSlots&&(entry.summary?.slotCount||0)<minSlots)return false;
  if(hasPreview&&!entry.previews?.length)return false;
  if(animation&&!(entry.summary?.animations||[]).some(name=>String(name).toLowerCase().includes(animation)))return false;
  const hay=[entry.title,entry.id,...(entry.summary?.animations||[])].join(' ').toLowerCase();
  return !terms.length||terms.every(term=>hay.includes(term));
 });
 const ranked=matches.map(entry=>{
  const hay=[entry.title,entry.id,...(entry.summary?.animations||[])].join(' ').toLowerCase();
  const score=terms.reduce((n,term)=>n+(String(entry.title||'').toLowerCase().includes(term)?4:0)+
   ((entry.summary?.animations||[]).some(name=>String(name).toLowerCase()===term)?5:0)+
   (String(entry.id||'').toLowerCase().includes(term)?1:0),0)+
   (entry.projectCompleteness==='complete'?2:0)+(entry.previews?.length?1:0);
  return {entry,score};
 }).sort((a,b)=>b.score-a.score||String(b.entry.uploadedAt||'').localeCompare(String(a.entry.uploadedAt||'')));
 const total=ranked.length;
 const entries=ranked.slice(offset,offset+limit).map(x=>publicEntry(x.entry));
 const body={schema:'sa.reference-library-search',version:1,generatedAt:index.generatedAt,
  sourceCommit:index.sourceCommit,summary:index.summary,total,offset,limit,entries};
 response.setHeader('Content-Type','application/json; charset=utf-8');
 if(request.method==='HEAD')return response.status(200).end();
 return response.status(200).json(body);
}
