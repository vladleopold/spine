import fs from 'node:fs';
import {createHash} from 'node:crypto';
export async function publishLargeDownload(file,{repository,token,uploadId,fetchImpl=fetch}){
 const size=fs.statSync(file).size;
 if(size>2*1024**3)throw Error('Download exceeds GitHub release asset limit: '+file);
 const hash=createHash('sha256');for await(const chunk of fs.createReadStream(file))hash.update(chunk);
 const name=hash.digest('hex').slice(0,16)+'-'+file.split('/').pop();
 const headers={Authorization:`Bearer ${token}`,Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'};
 const api='https://api.github.com/repos/'+repository;
 const tag='render-'+uploadId;
 const getRelease=()=>fetchImpl(api+'/releases/tags/'+encodeURIComponent(tag),{headers});
 let response=await getRelease();
 if(response.status===404){
  response=await fetchImpl(api+'/releases',{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify({tag_name:tag,target_commitish:'main',name:'Animation downloads: '+uploadId,prerelease:true,make_latest:'false'})});
  if(response.status===422)response=await getRelease();
 }
 if(!response.ok)throw Error('Download release metadata HTTP '+response.status);
 const release=await response.json();
 for(let attempt=0;attempt<4;attempt++){
  // Match hash-named assets; never delete an asset still referenced by a page.
  const list=await fetchImpl(api+'/releases/'+release.id+'/assets?per_page=100',{headers});
  if(!list.ok)throw Error('Download assets HTTP '+list.status);
  const existing=(await list.json()).find(asset=>asset.name===name&&asset.size===size&&asset.state==='uploaded');
  if(existing)return existing.browser_download_url;
  const upload=release.upload_url.replace(/\{.*$/, '')+'?name='+encodeURIComponent(name);
  const result=await fetchImpl(upload,{method:'POST',headers:{...headers,'Content-Type':'application/octet-stream','Content-Length':String(size)},body:fs.createReadStream(file),duplex:'half'});
  if(result.ok)return(await result.json()).browser_download_url;
  if(result.status!==422&&result.status!==429&&result.status<500)throw Error('Download upload HTTP '+result.status);
  if(attempt===3)throw Error('Download upload retries exhausted: HTTP '+result.status);
  await new Promise(resolve=>setTimeout(resolve,1000*(attempt+1)));
 }
}
