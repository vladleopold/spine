import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {listCollectionFolders,readIndex} from './resolve-library.mjs';
const hashString=value=>{let hash=5381;for(let i=0;i<value.length;i++)hash=(hash*33)^value.charCodeAt(i);return(hash>>>0).toString(36);};
let restored=0,unresolved=0;const changed=[];
for(const folder of listCollectionFolders(process.cwd())){
 const entries=readIndex(process.cwd(),folder);if(!entries)continue;let dirty=false;
 for(const entry of entries){
  if(entry.ownerEmail||entry.ownerAnonId||entry.ownerEmailSha256)continue;
  let recovered=null;
  const paths=[`${folder}/${entry.id}/source-proof.json`,entry.sourceProofPath,`${entry.previewPath}/source-proof.json`].filter(Boolean);
  for(const path of new Set(paths)){
   if(path.startsWith('/')||path.split('/').includes('..'))continue;
   try{
    const proof=JSON.parse(execFileSync('git',['show',`HEAD:${path}`],{encoding:'utf8',stdio:['ignore','pipe','ignore']}));
    const id=String(proof.uploader?.anonymousAccountId||'');
    if(proof.entryId!==entry.id||!/^anon_[a-z0-9_-]{3,96}$/i.test(id))continue;
    const emailHash=String(proof.uploader?.googleEmailSha256||'');
    if(proof.uploader?.mode==='google-account'&&!/^[a-f0-9]{64}$/i.test(emailHash))continue;
    if(!Array.isArray(proof.files)||!proof.files.length||!proof.proofHash)continue;
    recovered={id,fingerprint:String(proof.uploader?.anonymousFingerprint||''),emailHash};break;
   }catch{}
  }
  if(!recovered){unresolved++;continue;}
  if(recovered.emailHash)entry.ownerEmailSha256=recovered.emailHash;
  entry.ownerAnonId=recovered.id;if(recovered.fingerprint)entry.ownerAnonFingerprint=recovered.fingerprint;
  restored++;dirty=true;
 }
 if(dirty){const file=`${folder}/index.json`;fs.writeFileSync(file,JSON.stringify(entries,null,2));changed.push(file);}
}
console.log(JSON.stringify({restored,unresolved,collections:changed.length}));
fs.writeFileSync('/tmp/ownership-recovery-summary.json',JSON.stringify({restored,unresolved,collections:changed.length}));
