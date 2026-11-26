#!/usr/bin/env node
// Runs ONLY on the public vladleopold/spine GitHub-hosted Ubuntu runner.
// Does not parse .spine with a runtime or pretend a project is a .skel export.
// A licensed, initialized Spine Editor 4.3.26 CLI is required for conversion.
import fs from 'node:fs/promises';
import path from 'node:path';
import { runLicensedSpineExport } from './spine-editor-export.mjs';

const eventPath = process.env.GITHUB_EVENT_PATH;
const event = eventPath ? JSON.parse(await fs.readFile(eventPath, 'utf8')) : {};
const payload = { ...(event.client_payload || {}),
  uploadId: process.env.SPINE_UPLOAD_ID || event.client_payload?.uploadId,
  uploadPath: process.env.SPINE_UPLOAD_PATH || event.client_payload?.uploadPath,
  projectFile: process.env.SPINE_PROJECT_FILE || event.client_payload?.projectFile,
  origin: process.env.SPINE_SITE_ORIGIN || event.client_payload?.origin };
const uploadId = String(payload.uploadId || '');
const uploadPath = String(payload.uploadPath || '');
const projectFile = String(payload.projectFile || '');
const token = String(process.env.STORAGE_GITHUB_TOKEN || '');
const repo = 'vladleopold/spine'; // fixed storage destination
const root = process.env.SPINE_STORAGE_WORKSPACE || process.cwd();
const cli = String(process.env.SPINE_CLI || '');
const license = String(process.env.SPINE_LICENSE || '').trim();
if (!token || !/^[\w.-]{3,180}$/.test(uploadId) ||
    !/^library(?:_\d+)?\/[\w.-]{3,180}$/.test(uploadPath) ||
    uploadPath.split('/').at(-1) !== uploadId ||
    !/^[^/\\\x00-\x1f\x7f]+\.spine$/i.test(projectFile)) {
  throw new Error('Invalid Spine export job payload');
}
const folder = path.resolve(root, uploadPath);
const project = path.resolve(folder, projectFile);
const images = path.resolve(folder, 'images');
const output = path.resolve(folder, 'export');
const indexPath = uploadPath.split('/')[0] + '/index.json';
if (!project.startsWith(folder + path.sep) || !images.startsWith(folder + path.sep) ||
    !output.startsWith(folder + path.sep)) {
  throw new Error('Unsafe Spine project location');
}

const apiRoot = 'https://api.github.com/repos/' + repo;
async function api(method, url, body) {
  const response = await fetch(apiRoot + url, {
    method,
    headers: {
      Authorization: 'Bearer ' + token,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
      'Content-Type': 'application/json',
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error('GitHub ' + method + ' ' + url + ': ' + response.status + ' ' + String(data.message || '').slice(0,100));
    error.status = response.status;
    throw error;
  }
  return data;
}
async function indexFromHead(headSha) {
  const response = await api('GET', '/contents/' + indexPath + '?ref=' + headSha);
  const blob = response.sha && await api('GET', '/git/blobs/' + response.sha);
  const items = blob?.content ? JSON.parse(Buffer.from(blob.content, 'base64').toString('utf8')) : [];
  if (!Array.isArray(items)) throw new Error('Invalid storage index');
  const idx = items.findIndex(item => item?.id === uploadId);
  if (idx < 0 || items[idx]?.sourceKind !== 'spine-project' ||
      items[idx]?.projectFile !== projectFile ||
      items[idx]?.previewPath !== uploadPath) {
    throw new Error('Project not present in authorized storage index');
  }
  return {items,idx};
}
let status = 'ready', errorMessage = '';
let exported = [];
const projectExists = await fs.stat(project).then(s => s.isFile()).catch(() => false);
const imagesExist = await fs.stat(images).then(s => s.isDirectory()).catch(() => false);
if (!projectExists || !imagesExist) {
  status = 'failed'; errorMessage = 'Missing stored project or images folder';
} else if (!license || !cli || !await fs.stat(cli).then(s=>s.isFile()).catch(()=>false)) {
  status = 'needs-editor'; errorMessage = 'Licensed Spine Editor 4.3.26 cloud exporter is not configured';
} else {
  await fs.mkdir(output, {recursive:true});
  try {
    const result = runLicensedSpineExport({
      cli, project, output, images, license,
      workspaceRoot: path.resolve(root, '..'),
    });
    if (result.remappedPaths.length) {
      console.log('Rebound legacy project image path(s) to uploaded images/ without changing the source project:', result.remappedPaths.length);
    }
    const safeOutput = (result.stdout + '\n' + result.stderr)
      .replaceAll(license, '[REDACTED]')
      .replace(/Licensed to:.*$/gmi, 'Licensed to: [REDACTED]')
      .slice(-1600);
    if (safeOutput.trim()) console.log(safeOutput);
    const entries = await fs.readdir(output, {withFileTypes:true});
    exported = entries.filter(item => item.isFile() && /\.(json|skel|atlas|png|jpe?g|webp)$/i.test(item.name))
      .map(item => item.name)
      .filter(name => name !== 'source-proof.json');
    if (!exported.some(name=>/\.(json|skel)$/i.test(name)) ||
        !exported.some(name=>/\.atlas$/i.test(name)) ||
        !exported.some(name=>/\.(png|jpe?g|webp)$/i.test(name))) {
      status = 'failed'; errorMessage = 'Editor returned no complete runtime JSON/atlas/texture output';
      exported = [];
    } else {
      // A complete valid runtime export is required before marking a work ready.
      const json = exported.find(name => /\.json$/i.test(name));
      try {
        if (!json) throw Error('JSON runtime export required');
        const skeleton = JSON.parse(await fs.readFile(path.join(output,json),'utf8'));
        if (!String(skeleton.skeleton?.spine || '').startsWith('4.3.')) throw Error('Export version is not Spine 4.3');
        if (!Object.keys(skeleton.animations || {}).length) throw Error('No playable animations in project');
        const atlas = await fs.readFile(path.join(output,exported.find(name=>/\.atlas$/i.test(name))),'utf8');
        if (!atlas.trim()) throw Error('Empty texture atlas');
        const pages = [...atlas.matchAll(/^([^\r\n]+\.(?:png|jpe?g|webp))\s*$/gmi)].map(m=>m[1].trim());
        if (!pages.length) throw Error('No atlas texture pages');
        const imageNames = new Set(exported.filter(name=>/\.(png|jpe?g|webp)$/i.test(name)));
        for (const page of pages) if (!imageNames.has(page)) throw Error('Missing atlas page: ' + page);
      } catch(error) {
        status = 'failed'; errorMessage = 'Runtime validation failed: ' + String(error.message || error).slice(0,180);
        exported = [];
      }
    }
  } catch (error) {
    status = 'failed';
    errorMessage = 'Spine Editor CLI export failed: ' + String(error?.message || error).slice(0, 280);
    console.error(errorMessage);
  }
}
console.log('Spine project conversion status:', status, 'files:', exported.length);
const writes = [];
if (status === 'ready') {
  for (const name of exported) {
    const buffer = await fs.readFile(path.join(output, name));
    const blob = await api('POST', '/git/blobs', { content: buffer.toString('base64'), encoding: 'base64' });
    writes.push({ path: uploadPath + '/export/' + name, mode:'100644', type:'blob', sha:blob.sha });
  }
}
let committed = false;
for (let attempt=0;attempt<7;attempt++) {
  // Pin the index read to the exact parent commit, or another upload could
  // be silently lost when we update the library under concurrent traffic.
  const ref=await api('GET','/git/refs/heads/main');
  const head=String(ref?.object?.sha || '');
  const {items,idx} = await indexFromHead(head);
  const existing = items[idx];
  // A duplicate delivery cannot roll a successfully exported work backwards.
  if (existing?.conversionStatus === 'ready') { committed=true; status='ready'; break; }
  const skeletonName = exported.find(name => /\.(json|skel)$/i.test(name)) || '';
  const skeleton = skeletonName ? 'export/' + skeletonName : '';
  const atlasName = exported.find(name => /\.atlas$/i.test(name)) || '';
  const atlas = atlasName ? 'export/' + atlasName : '';
  const textures = exported.filter(name => /\.(png|jpe?g|webp)$/i.test(name)).map(name => 'export/' + name);
  let animations = [];
  if (skeletonName.endsWith('.json')) {
    try {
      const data = JSON.parse(await fs.readFile(path.join(output,skeletonName),'utf8'));
      animations = Object.keys(data.animations || {});
    } catch {}
  }
  items[idx] = {
    ...existing,
    conversionStatus:status,
    conversionError:errorMessage,
    ...(status === 'ready' ? {
      files:[...new Set([...(existing.files || []),...exported.map(name => 'export/' + name)])],
      skeleton,atlas,textures,animations,
      defaultAnimation:animations[0] || '',
      webmStatus:'pending',dispatchStatus:'pending',
    }:{}),
  };
  const indexBlob=await api('POST','/git/blobs',{
    content:Buffer.from(JSON.stringify(items,null,2)).toString('base64'),encoding:'base64',
  });
  const commit=await api('GET','/git/commits/'+head);
  const tree=await api('POST','/git/trees',{
    base_tree:commit.tree.sha,
    tree:[...writes,{path:indexPath,mode:'100644',type:'blob',sha:indexBlob.sha}],
  });
  const next=await api('POST','/git/commits',{
    message:'Spine project editor export: '+uploadId+' ('+status+')',
    tree:tree.sha, parents:[head],
  });
  try {
    await api('PATCH','/git/refs/heads/main',{sha:next.sha,force:false});
    committed=true;
    console.log('Stored conversion status at commit:',next.sha);
    break;
  } catch (error) {
    if (![409,422].includes(error.status) || attempt===6) throw error;
  }
}
if (!committed) throw new Error('Could not update project conversion status');
if (status === 'ready') {
  try {
    await api('POST','/dispatches',{
      event_type:'spine-export-webm',client_payload:{
        uploadId,animation:'',animations:[],origin:String(payload.origin||''),
        owner:repo.split('/')[0],repo:repo.split('/')[1],branch:'main',
      },
    });
  } catch(error) {console.warn('Video export dispatch failed:',String(error));}
}

if (status !== 'ready') process.exitCode = 1;
