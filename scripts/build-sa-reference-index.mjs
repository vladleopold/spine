#!/usr/bin/env node
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';

const ROOT = process.cwd();
const EXCLUDED_JSON = new Set(['source-proof.json','blockchain-anchor.json','manifest.json',
  'generation.json','visual-review.json','project.animation.json','index.json','metrics.json']);
const PREVIEW_RE = /(?:^|\/)(?:preview[^/]*|[^/]*preview[^/]*)\.(webm|webp|mp4|png)$/i;
const IMAGE_RE = /\.(png|jpe?g|webp)$/i;
const RAW_BASE = 'https://raw.githubusercontent.com/vladleopold/spine';

function git(args, maxBuffer = 64 * 1024 * 1024) {
  return execFileSync('git', args, { cwd: ROOT, encoding: 'buffer', maxBuffer });
}
function gitText(args) { return git(args).toString('utf8').trim(); }
function readBlob(commit, filePath) {
  try { return gitText(['show', commit + ':' + filePath]); }
  catch { return null; }
}
function sha256(value) { return createHash('sha256').update(value).digest('hex'); }
function safeJson(text) { try { return JSON.parse(text); } catch { return null; } }
function dateFromFolder(id) {
  const match = String(id).match(/(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/);
  return match ? match[1] + 'T' + match[2] + ':' + match[3] + ':' + match[4] + '.' + match[5] + 'Z' : '';
}
function titleFromFolder(id) {
  return String(id).replace(/-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}-\d{3}Z$/, '')
    .replace(/[-_]+/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 180) || String(id).slice(0,180);
}
export function parseAtlasPages(atlasText) {
  const lines = String(atlasText || '').split(/\r?\n/).map(x => x.trim());
  const pages = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (!line || !IMAGE_RE.test(line)) continue;
    const next = lines[i + 1] || '';
    if (/^(size|format|filter|repeat|pma):/i.test(next)) pages.push(line.replace(/\\/g, '/'));
  }
  return [...new Set(pages)];
}
function skinsOf(json) {
  if (Array.isArray(json?.skins)) return json.skins;
  if (json?.skins && typeof json.skins === 'object') return Object.values(json.skins);
  return [];
}
export function summarizeSkeleton(json) {
  if (!json || !Array.isArray(json.bones) || !Array.isArray(json.slots) ||
      !json.animations || typeof json.animations !== 'object' || Array.isArray(json.animations)) return null;
  const attachments = [];
  for (const skin of skinsOf(json)) {
    const map = skin?.attachments && typeof skin.attachments === 'object' ? skin.attachments : skin;
    if (!map || typeof map !== 'object') continue;
    for (const slot of Object.values(map)) {
      if (!slot || typeof slot !== 'object') continue;
      for (const attachment of Object.values(slot)) if (attachment && typeof attachment === 'object') attachments.push(attachment);
    }
  }
  const clips = Object.entries(json.animations).map(([name, animation]) => ({
    name: String(name).slice(0,180),
    keyframes: countKeyframes(animation),
    drawOrderFrames: Array.isArray(animation?.drawOrder) ? animation.drawOrder.length : 0
  }));
  return {
    spineVersion: String(json.skeleton?.spine || json.skeleton?.version || '').slice(0,32),
    boneCount: json.bones.length,
    slotCount: json.slots.length,
    skinCount: skinsOf(json).length,
    ikConstraintCount: Array.isArray(json.ik) ? json.ik.length : 0,
    transformConstraintCount: Array.isArray(json.transform) ? json.transform.length : 0,
    pathConstraintCount: Array.isArray(json.path) ? json.path.length : 0,
    physicsConstraintCount: Array.isArray(json.physics) ? json.physics.length : 0,
    attachmentCount: attachments.length,
    meshCount: attachments.filter(x => x.type === 'mesh' || x.type === 'linkedmesh').length,
    weightedMeshCount: attachments.filter(x => (x.type === 'mesh' || x.type === 'linkedmesh') && Array.isArray(x.bones) && x.bones.length > 0).length,
    clippingAttachmentCount: attachments.filter(x => x.type === 'clipping').length,
    animations: clips.map(x => x.name),
    clipStats: clips,
    animationCount: clips.length,
    keyframeCount: clips.reduce((n,x) => n + x.keyframes, 0)
  };
}
function countKeyframes(value) {
  let total = 0, stack = [value], visited = 0;
  while (stack.length && visited < 250000) {
    const item = stack.pop(); visited++;
    if (Array.isArray(item)) {
      if (item.length && item.every(x => x && typeof x === 'object' && Number.isFinite(x.time))) total += item.length;
      else for (const child of item) if (child && typeof child === 'object') stack.push(child);
    } else if (item && typeof item === 'object') {
      for (const child of Object.values(item)) if (child && typeof child === 'object') stack.push(child);
    }
  }
  return total;
}
function rawUrl(commit, filePath) {
  return RAW_BASE + '/' + commit + '/' + filePath.split('/').map(encodeURIComponent).join('/');
}
function resolveTexturePaths(atlasPath, projectPath, pages, files) {
  const dir = path.posix.dirname(atlasPath);
  return pages.map(page => {
    const candidates = [path.posix.normalize(path.posix.join(dir,page)),
      path.posix.normalize(path.posix.join(projectPath,page))];
    return files.find(file => candidates.includes(file) || file.endsWith('/' + page)) || null;
  });
}
function candidateScore(summary, filePath) {
  return summary.boneCount * 2 + summary.slotCount + summary.animationCount * 4 +
    (filePath.toLowerCase().includes('skeleton') ? 5 : 0);
}
export function buildProjectEntry({ collection, id, files, commit, readFile }) {
  const projectPath = collection + '/' + id;
  const projectFiles = files.filter(file => file.startsWith(projectPath + '/'));
  const jsonCandidates = projectFiles.filter(file => file.toLowerCase().endsWith('.json') &&
    !EXCLUDED_JSON.has(path.posix.basename(file).toLowerCase()));
  const skeletons = [];
  for (const file of jsonCandidates) {
    const raw = readFile(file);
    if (!raw) continue;
    const json = safeJson(raw);
    const summary = summarizeSkeleton(json);
    if (summary) skeletons.push({ file, raw, summary });
  }
  skeletons.sort((a,b) => candidateScore(b.summary,b.file) - candidateScore(a.summary,a.file));
  const chosen = skeletons[0] || null;
  const atlases = projectFiles.filter(file => file.toLowerCase().endsWith('.atlas'));
  const atlasPath = chosen
    ? atlases.find(file => path.posix.basename(file).replace(/\.atlas$/i,'').toLowerCase() ===
      path.posix.basename(chosen.file).replace(/\.json$/i,'').toLowerCase()) || atlases[0] || null
    : atlases[0] || null;
  const atlasText = atlasPath ? readFile(atlasPath) : '';
  const atlasPages = parseAtlasPages(atlasText);
  const texturePaths = atlasPath ? resolveTexturePaths(atlasPath,projectPath,atlasPages,projectFiles) : [];
  const previews = projectFiles.filter(file => PREVIEW_RE.test(file)).map(file => ({
    path:file,
    kind:/\.webm$/i.test(file)?'video':/\.mp4$/i.test(file)?'video':'poster',
    format:path.posix.extname(file).slice(1).toLowerCase(),
    url:rawUrl(commit,file)
  }));
  const sourceProofPath = projectFiles.find(file => path.posix.basename(file).toLowerCase()==='source-proof.json');
  const anchorPath = projectFiles.find(file => path.posix.basename(file).toLowerCase()==='blockchain-anchor.json');
  let proof = null;
  if (sourceProofPath) {
    const parsed = safeJson(readFile(sourceProofPath));
    if (parsed && typeof parsed === 'object') proof = {
      title:typeof parsed.title==='string'?parsed.title.slice(0,180):'',
      uploadedAt:typeof parsed.uploadedAt==='string'?parsed.uploadedAt:'',
      proofPresent:true
    };
  }
  const summary = chosen?.summary || null;
  const webm = previews.find(x=>x.kind==='video'&&x.format==='webm');
  const poster = previews.find(x=>x.kind==='poster'&&x.format==='webp') || previews.find(x=>x.kind==='poster');
  const complete = !!(chosen && atlasPath && atlasPages.length && texturePaths.length===atlasPages.length &&
    texturePaths.every(Boolean));
  const skeletonHash = chosen ? sha256(chosen.raw) : null;
  const atlasHash = atlasText ? sha256(atlasText) : null;
  return {
    id, title:proof?.title||titleFromFolder(id), collection, projectPath,
    uploadedAt:proof?.uploadedAt||dateFromFolder(id)||null,
    sourceRepository:'vladleopold/spine', sourceCommit:commit,
    skeletonPath:chosen?.file||null, atlasPath, texturePaths:texturePaths.filter(Boolean),
    atlasPageCount:atlasPages.length, hasAllAtlasTextures:atlasPages.length>0&&texturePaths.length===atlasPages.length&&texturePaths.every(Boolean),
    skeletonSha256:skeletonHash, atlasSha256:atlasHash, summary,
    previews, previewUrl:webm?.url||poster?.url||null, posterUrl:poster?.url||null,
    sourceProofPresent:!!sourceProofPath, blockchainAnchorPresent:!!anchorPath,
    projectCompleteness:complete?'complete':'incomplete',
    rights:{status:'unverified',trainingEligible:false,sourceReuseAllowed:false,
      note:'Public visibility and source provenance do not establish a license for training or asset reuse.'},
    review:{status:'not-independently-reviewed',nativeEditorVerified:false,visualApproved:false}
  };
}
function listTreePaths(commit, collection) {
  return git(['ls-tree','-r','-z','--name-only',commit,'--',collection]).toString('utf8')
    .split('\0').filter(Boolean);
}
function collectionNames(commit) {
  return git(['ls-tree','--name-only',commit]).toString('utf8').split('\n')
    .filter(name=>/^library(?:_\d+)?$/.test(name));
}
export async function buildIndex({commit=gitText(['rev-parse','HEAD']),readFile=path=>readBlob(commit,path)}={}) {
  const projects=[],collections=[];
  for (const collection of collectionNames(commit)) {
    const paths=listTreePaths(commit,collection);
    const ids=[...new Set(paths.map(file=>file.slice(collection.length+1).split('/')[0]).filter(Boolean))];
    collections.push({id:collection,projectFolders:ids.length,files:paths.length});
    for (const id of ids) {
      const entry=buildProjectEntry({collection,id,files:paths,commit,readFile});
      if (entry.summary || entry.previews.length) projects.push(entry);
    }
  }
  projects.sort((a,b)=>String(b.uploadedAt||'').localeCompare(String(a.uploadedAt||''))||a.id.localeCompare(b.id));
  return {
    schema:'sa.reference-library-index',version:1,generatedAt:new Date().toISOString(),
    sourceRepository:'vladleopold/spine',sourceCommit:commit,collections,
    summary:{
      projectCount:projects.length,
      skeletonProjectCount:projects.filter(x=>!!x.summary).length,
      completeProjectCount:projects.filter(x=>x.projectCompleteness==='complete').length,
      previewProjectCount:projects.filter(x=>x.previews.length>0).length,
      animationClipCount:projects.reduce((n,x)=>n+(x.summary?.animationCount||0),0),
      sourceProofCount:projects.filter(x=>x.sourceProofPresent).length,
      trainingEligibleCount:0
    },
    projects
  };
}
async function main(){
  const index=await buildIndex();
  const output=path.join(ROOT,'public','sa-reference-index.json');
  fs.mkdirSync(path.dirname(output),{recursive:true});
  fs.writeFileSync(output,JSON.stringify(index)+'\n');
  process.stdout.write(JSON.stringify({output,summary:index.summary,collections:index.collections})+'\n');
}
if (process.argv[1] && path.resolve(process.argv[1])===path.resolve(new URL(import.meta.url).pathname)) await main();
