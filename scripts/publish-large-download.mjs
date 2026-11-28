import fs from 'node:fs';
import {createHash} from 'node:crypto';

async function fetchWithTimeout(fetchImpl, url, options, timeoutMs, consumeResponse) {
 const controller = new AbortController();
 const timer = setTimeout(() => controller.abort(), timeoutMs);
 try {
  const response = await fetchImpl(url, {...options, signal:controller.signal});
  return await consumeResponse(response);
 } catch (cause) {
  if (controller.signal.aborted) {
   const error = new Error(\`Download request timed out after \${timeoutMs}ms\`);
   error.code = 'DOWNLOAD_REQUEST_TIMEOUT';
   error.timeoutMs = timeoutMs;
   error.cause = cause;
   throw error;
  }
  throw cause;
 } finally {
  clearTimeout(timer);
 }
}

const responseAndJson = async response => ({
 response,
 data: response.ok ? await response.json() : null,
});

export async function publishLargeDownload(file,{
 repository,
 token,
 uploadId,
 fetchImpl=fetch,
 requestTimeoutMs=30_000,
 uploadTimeoutMs=10*60_000,
}){
 const size=fs.statSync(file).size;
 if(size>2*1024**3)throw Error('Download exceeds GitHub release asset limit: '+file);
 const hash=createHash('sha256');for await(const chunk of fs.createReadStream(file))hash.update(chunk);
 const name=hash.digest('hex').slice(0,16)+'-'+file.split('/').pop();
 const headers={Authorization:\`Bearer \${token}\`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'};
 const api='https://api.github.com/repos/'+repository;
 const tag='render-'+uploadId;
 const getRelease=()=>fetchWithTimeout(fetchImpl,api+'/releases/tags/'+encodeURIComponent(tag),{headers},requestTimeoutMs,responseAndJson);
 let {response,data:release}=await getRelease();
 if(response.status===404){
  const created=await fetchWithTimeout(fetchImpl,api+'/releases',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({tag_name:tag,target_commitish:'main',name:'Animation downloads: '+uploadId,prerelease:true,make_latest:'false'})},requestTimeoutMs,responseAndJson);
  response=created.response;
  release=created.data;
  if(response.status===422){
   const existing=await getRelease();
   response=existing.response;
   release=existing.data;
  }
 }
 if(!response.ok)throw Error('Download release metadata HTTP '+response.status);
 for(let attempt=0;attempt<4;attempt++){
  const listed=await fetchWithTimeout(fetchImpl,api+'/releases/'+release.id+'/assets?per_page=100',{headers},requestTimeoutMs,responseAndJson);
  if(!listed.response.ok)throw Error('Download assets HTTP '+listed.response.status);
  const existing=listed.data.find(asset=>asset.name===name&&asset.size===size&&asset.state==='uploaded');
  if(existing)return existing.browser_download_url;
  const upload=release.upload_url.replace(/\{.*$/, '')+'?name='+encodeURIComponent(name);
  const uploaded=await fetchWithTimeout(fetchImpl,upload,{method:'POST',headers:{...headers,'Content-Type':'application/octet-stream','Content-Length':String(size)},body:fs.createReadStream(file),duplex:'half'},uploadTimeoutMs,responseAndJson);
  if(uploaded.response.ok)return uploaded.data.browser_download_url;
  if(uploaded.response.status!==422&&uploaded.response.status!==429&&uploaded.response.status<500)throw Error('Download upload HTTP '+uploaded.response.status);
  if(attempt===3)throw Error('Download upload retries exhausted: HTTP '+uploaded.response.status);
  await new Promise(resolve=>setTimeout(resolve,1000*(attempt+1)));
 }
}
