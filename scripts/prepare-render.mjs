import fs from 'node:fs';
import {execFileSync} from 'node:child_process';
import {entryForUpload} from './resolve-library.mjs';
const event=JSON.parse(fs.readFileSync(process.env.GITHUB_EVENT_PATH,'utf8'));
const config=process.env.GITHUB_EVENT_NAME==='push'?JSON.parse(fs.readFileSync('scripts/render-check.json','utf8')):(event.client_payload||event.inputs||{});
const found=entryForUpload(process.cwd(),String(config.uploadId||''));
if(!found)throw Error('Upload not found');
const work=String(found.entry.previewPath||`${found.basePath}/${config.uploadId}`);
if(work.startsWith('/')||work.split('/').includes('..'))throw Error('Invalid work path');
execFileSync('git',['sparse-checkout','add','--skip-checks',`/${work}/`],{stdio:'inherit'});

if(process.env.GITHUB_OUTPUT)fs.appendFileSync(process.env.GITHUB_OUTPUT,`dispatch_only=${config.dispatchOnly===true}\n`);
