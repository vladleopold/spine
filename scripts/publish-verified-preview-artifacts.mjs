#!/usr/bin/env node
/** Atomically publish only fully checked media from a completed render job.
 * One failed/missing source must not delay or corrupt already verified previews.
 * No fabricated posters, zero-duration videos, or unrelated file replacements.
 */
import fs from 'node:fs';
import path from 'node:path';
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {listCollectionFolders,readIndex} from './resolve-library.mjs';

const root=process.cwd();
const artifactsRoot=path.resolve(root,'downloaded-latest10');
const prefix='latest10-';
const idPattern=/^Spine-animation-\d{4}-\d\d-\d\dT\d\d-\d\d-\d\d-\d{3}Z$/;
const names=['preview.webm','preview-medium.webm','preview-low.webm',
 'preview.webp','preview-medium.webp','preview-low.webp'];
const rows=new Map();
for(const collection of listCollectionFolders(root)){
 const records=readIndex(root,collection)||[];
 for(const row of records){
  if(idPattern.test(row?.id||'')&&!rows.has(row.id))rows.set(row.id,{row,collection,records});
 }
}
function probe(file){
 const text=execFileSync('ffprobe',['-v','error','-count_frames','-select_streams','v:0',
  '-show_entries','stream=width,height,nb_read_frames:format=duration','-of','json',file],
  {encoding:'utf8',timeout:30000,maxBuffer:65536});
 const meta=JSON.parse(text),stream=meta.streams?.[0];
 const frames=Number(stream?.nb_read_frames),duration=Number(meta.format?.duration);
 if(!(frames>=8&&duration>=0.5&&duration<=600&&frames/duration>=15
     &&stream?.width>=2&&stream?.height>=2)){
  throw new Error('Video fails duration/frame-rate/dimension quality gate');
 }
 return {frames,duration,width:stream.width,height:stream.height};
}
function validate(folder){
 const meta=JSON.parse(fs.readFileSync(path.join(folder,'meta.json'),'utf8'));
 if(meta?.ok!==true||!/^[a-f0-9]{64}$/i.test(meta.sha256||'')||!meta.animation)
  throw new Error('Missing signed result metadata');
 const buffers=new Map();
 for(const name of names){
  const file=path.join(folder,name);
  if(!fs.statSync(file).isFile()||fs.statSync(file).size<=128)
   throw new Error('Incomplete export');
  const bytes=fs.readFileSync(file);
  const sizeKey=name==='preview.webm'?'webmHigh':
   name==='preview-medium.webm'?'webmMedium':
   name==='preview-low.webm'?'webmLow':
   name==='preview.webp'?'webpHigh':
   name==='preview-medium.webp'?'webpMedium':'webpLow';
  if(meta.files?.[sizeKey]!==bytes.length)throw new Error('Artifact size proof mismatch');
  if(name.endsWith('.webp')){
   if(bytes.toString('ascii',0,4)!=='RIFF'||bytes.toString('ascii',8,12)!=='WEBP')
    throw new Error('Poster is not real WebP');
  }else probe(file);
  buffers.set(name,bytes);
 }
 if(createHash('sha256').update(buffers.get('preview.webm')).digest('hex')!==meta.sha256)
  throw new Error('WebM SHA-256 mismatch');
 return {meta,video:probe(path.join(folder,'preview.webm')),buffers};
}
const updates=new Set();
let published=0,skipped=0;
const artifacts=fs.existsSync(artifactsRoot)
 ?fs.readdirSync(artifactsRoot,{withFileTypes:true}).filter(x=>x.isDirectory()&&x.name.startsWith(prefix)):[];
for(const a of artifacts){
 const id=a.name.slice(prefix.length),reference=rows.get(id);
 if(!idPattern.test(id)||!reference){skipped++;continue;}
 const {row,collection}=reference;
 const uploadPath=String(row.previewPath||collection+'/'+id).replace(/\\/g,'/');
 if(uploadPath!==collection+'/'+id) {skipped++;continue;}
 let result;
 try{
  if(!Array.isArray(row.files)||!row.files.some(f=>/\.(json|skel)$/i.test(f))
    ||!row.files.some(f=>/\.atlas(?:\.txt|\.docx)?$/i.test(f))
    ||!row.files.some(f=>/\.(png|jpe?g|webp|dds)$/i.test(f)))
   throw new Error('Incomplete original files');
  result=validate(path.join(artifactsRoot,a.name));
 }catch(error){
  console.error('SKIP_UNVERIFIED_PREVIEW '+id+': '+error.message);
  skipped++;continue;
 }
 const dst=path.resolve(root,uploadPath);
 if(!dst.startsWith(root+path.sep))throw new Error('Unsafe destination');
 fs.mkdirSync(dst,{recursive:true});
 for(const name of names)fs.writeFileSync(path.join(dst,name),result.buffers.get(name));
 const media='https://spine-link.vercel.app/assets/'+uploadPath+'/';
 row.webmPreview=media+'preview.webm';
 row.webmPreviewMedium=media+'preview-medium.webm';
 row.webmPreviewLow=media+'preview-low.webm';
 row.thumbnailPoster=media+'preview.webp';
 row.webpPoster=media+'preview.webp';
 row.webpPosterMedium=media+'preview-medium.webp';
 row.webpPosterLow=media+'preview-low.webp';
 row.webmStatus='ready';row.previewStatus='ready';row.dispatchStatus='rendered';
 row.previewError='';
 row.webmGeneratedAt=new Date().toISOString();
 row.posterGeneratedAt=row.webmGeneratedAt;
 row.previewDuration=result.video.duration;
 row.previewFrameCount=result.video.frames;
 row.previewWidth=result.video.width;row.previewHeight=result.video.height;
 row.defaultAnimation=result.meta.animation;
 if(Array.isArray(result.meta.animations)&&result.meta.animations.length)
  row.animations=result.meta.animations;
 const old=row.allAnimationPreviews&&typeof row.allAnimationPreviews==='object'?row.allAnimationPreviews:{};
 row.allAnimationPreviews={...old,[result.meta.animation]:{
  ...(old[result.meta.animation]||{}),webmPreview:row.webmPreview,
  webmPreviewMedium:row.webmPreviewMedium,webmPreviewLow:row.webmPreviewLow,
  webpPoster:row.webpPoster,webpPosterMedium:row.webpPosterMedium,
  webpPosterLow:row.webpPosterLow}};
 updates.add(collection);published++;
 console.log('VERIFIED_PREVIEW_STAGED '+id+' frames='+result.video.frames);
}
for(const collection of updates){
 fs.writeFileSync(path.join(root,collection,'index.json'),
  JSON.stringify((readIndex(root,collection)||[]).map(current=>{
   const newRecord=rows.get(current.id);
   return newRecord&&newRecord.collection===collection?newRecord.row:current;
  }),null,2)+'\n');
}
console.log('VERIFIED_PREVIEW_BATCH '+JSON.stringify({published,skipped,artifactCount:artifacts.length}));
if(published===0)process.exitCode=1;
