import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {entryForUpload} from './resolve-library.mjs';
const event=JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH,'utf8'));
const config=process.env.GITHUB_EVENT_NAME==='push'?JSON.parse(fs.readFileSync('scripts/render-check.json','utf8')):(event.client_payload||event.inputs||{});
const uploadId=String(config.uploadId||'');
if(uploadId)console.log(`::add-mask::${uploadId}`);
const found=entryForUpload(process.cwd(),uploadId);
if(!found)throw Error('Upload not found');
const work=String(found.entry.previewPath||`${found.basePath}/${uploadId}`);
const privateValues=[work,found.entry.previewPath,found.entry.skeleton,found.entry.atlas,
  ...(Array.isArray(found.entry.files)?found.entry.files:[]),
  ...(Array.isArray(found.entry.animations)?found.entry.animations:[])];
for(const value of new Set(privateValues.map(value=>String(value||'').trim())
  .filter(value=>value.length>=4&&!/[\\r\\n]/.test(value))))
  console.log(`::add-mask::${value}`);
if(work.startsWith('/')||work.split('/').includes('..'))throw Error('Invalid work path');
// Production's synthetic four-file upload verifies storage/deletion only. Its
// placeholder animation is not a render acceptance test and must not consume
// a heavy browser/ffmpeg worker or generate a false failed preview.
const skipRender=found.entry.testOnly===true &&
  found.entry.hiddenFromPublicLibrary===true &&
  /^spine-link-e2e-\d{4}-/.test(String(config.uploadId||''));
if(!skipRender) {
  execFileSync('git',['sparse-checkout','add','--skip-checks',`/${work}/`],{stdio:'inherit'});
} else {
  console.log('SKIP_TEST_ONLY_WEBM_RENDER');
}
if(process.env.GITHUB_OUTPUT) {
  fs.appendFileSync(process.env.GITHUB_OUTPUT,`dispatch_only=${config.dispatchOnly===true}\n`);
  fs.appendFileSync(process.env.GITHUB_OUTPUT,`skip_render=${skipRender}\n`);
}
