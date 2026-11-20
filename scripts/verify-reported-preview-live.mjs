#!/usr/bin/env node
// Validate public Spine work media strictly from production after CI publication.
// Distinguish a blocked origin / temporary HTTP failure from a broken media object.
import {readIndex} from './resolve-library.mjs';
import {
  classifyOriginHttpStatus,
  classifyPreviewHttpStatus,
  classifyReportedPreviewEntry,
} from './lib/reported-preview-live-status.mjs';
const ids=["boss_1-2026-11-14T20-07-17-943Z","Spine-animation-2026-11-14T22-21-53-616Z","Spine-animation-2026-11-17T05-25-45-640Z","Spine-animation-2026-11-17T05-40-26-980Z","wolf-2026-11-17T07-14-36-248Z","wolf_v13-2026-11-17T15-57-55-338Z","config-2026-11-17T17-15-57-407Z","Spine-animation-2026-11-17T18-04-48-688Z","Spine-animation-2026-11-17T17-50-04-803Z","Spine-animation-2026-11-17T18-06-25-641Z","Spine-animation-2026-11-17T18-07-35-146Z","Spine-animation-2026-11-17T18-17-09-503Z","Spine-animation-2026-11-17T18-19-06-491Z","Spine-animation-2026-11-17T18-26-20-981Z","Spine-animation-2026-11-17T18-26-38-201Z","Spine-animation-2026-11-17T18-27-52-258Z","Spine-animation-2026-11-17T18-36-51-976Z","Spine-animation-2026-11-17T18-39-06-745Z"];
const entries=readIndex(process.cwd(),'library_02')||[];
const summary={requested:ids.length,ready:0,blocked:0,failed:0,mediaVerified:0};

let originStatus=0;
try {
 const response=await fetch('https://spine-link.vercel.app/',{
  cache:'no-store',signal:AbortSignal.timeout(15000)
 });
 originStatus=response.status;
} catch {}
if(classifyOriginHttpStatus(originStatus)!=='ok') {
 summary.blocked=ids.length;
 summary.blockedReason=originStatus?('PRODUCTION_ORIGIN_HTTP_'+originStatus):'PRODUCTION_ORIGIN_UNREACHABLE';
 console.log('REPORTED_PREVIEW_PRODUCTION_AUDIT='+JSON.stringify(summary));
 console.error('REPORTED_PREVIEW_PRODUCTION_BLOCKED reason='+summary.blockedReason);
 process.exitCode=2;
} else {
 for(let slot=0;slot<ids.length;slot++) {
  const id=ids[slot];
  const e=entries.find(x=>x.id===id);
  if(!e) {
   console.error('SOURCE_INDEX_MISSING slot='+slot);
   summary.failed++;
   continue;
  }

  const readiness=classifyReportedPreviewEntry(e);
  if(readiness!=='ready') {
   if(readiness==='blocked') {
    summary.blocked++;
    console.log('PREVIEW_BLOCKED slot='+slot+' state='+String(e.webmStatus||e.previewStatus||'pending'));
   } else {
    summary.failed++;
    console.error('PREVIEW_FAILED slot='+slot+' state='+String(e.webmStatus||e.previewStatus||'failed'));
   }
   continue;
  }

  const assets=[['webm',e.webmPreview],['webp',e.webpPoster||e.thumbnailPoster]];
  let outcome='ready';
  for(const [kind,url] of assets) {
   if(!url||!url.startsWith('https://spine-link.vercel.app/assets/')) {
    outcome='failed';
    console.error('REPORTED_PREVIEW_LIVE_FAILED slot='+slot+' reason=INVALID_PUBLIC_ASSET_URL');
    break;
   }
   try {
    const resp=await fetch(url+(url.includes('?')?'&':'?')+'check='+encodeURIComponent(e.webmGeneratedAt||id),{
     signal:AbortSignal.timeout(20000),cache:'no-store'
    });
    const httpClass=classifyPreviewHttpStatus(resp.status);
    if(httpClass==='blocked') {
     outcome='blocked';
     console.error('REPORTED_PREVIEW_LIVE_BLOCKED slot='+slot+' kind='+kind+' http='+resp.status);
     break;
    }
    if(httpClass==='failed') {
     outcome='failed';
     console.error('REPORTED_PREVIEW_LIVE_FAILED slot='+slot+' kind='+kind+' http='+resp.status);
     break;
    }
    const buf=new Uint8Array(await resp.arrayBuffer());
    const sig=kind==='webm'
      ? buf[0]===26&&buf[1]===69&&buf[2]===223&&buf[3]===163
      : String.fromCharCode(...buf.slice(0,4))==='RIFF'&&String.fromCharCode(...buf.slice(8,12))==='WEBP';
    if(!sig||buf.length<256) {
     outcome='failed';
     console.error('REPORTED_PREVIEW_LIVE_FAILED slot='+slot+' kind='+kind+' reason=INVALID_MEDIA_SIGNATURE');
     break;
    }
    summary.mediaVerified++;
   } catch {
    outcome='blocked';
    console.error('REPORTED_PREVIEW_LIVE_BLOCKED slot='+slot+' kind='+kind+' reason=TRANSPORT_UNAVAILABLE');
    break;
   }
  }
  if(outcome==='ready') {
   summary.ready++;
   console.log('REPORTED_PREVIEW_LIVE_OK slot='+slot);
  } else if(outcome==='blocked') summary.blocked++;
  else summary.failed++;
 }
 console.log('REPORTED_PREVIEW_PRODUCTION_AUDIT='+JSON.stringify(summary));
 process.exitCode=summary.failed>0?1:summary.blocked>0?2:0;
}
