#!/usr/bin/env node
// Trusted public storage repository queue for Spine-Link editor projects.
// Reads immutable project identifiers from the storage index, never executes
// files supplied by a website as code.
import fs from 'node:fs/promises';

export const STORAGE_REPO = 'vladleopold/spine';
const TOKEN = process.env.STORAGE_GITHUB_TOKEN || '';
const API = 'https://api.github.com/repos/' + STORAGE_REPO;
const requested = String(process.env.REQUESTED_UPLOAD_ID || '').trim();
const idPattern = /^[\w.-]{3,180}$/;
const pathPattern = /^library(?:_\d+)?\/[\w.-]{3,180}$/;
export function eligible(entry, requestedId = '') {
  const id = String(entry?.id || '');
  const folder = String(entry?.previewPath || '');
  const project = String(entry?.projectFile || '');
  return entry?.sourceKind === 'spine-project' && entry?.testOnly !== true &&
    idPattern.test(id) && (!requestedId || requestedId === id) &&
    pathPattern.test(folder) && folder.endsWith('/' + id) &&
    /^[^/\\\x00-\x1f\x7f]+\.spine$/i.test(project) &&
    (['pending','needs-editor'].includes(entry?.conversionStatus) ||
     (requestedId === id && entry?.conversionStatus === 'failed'));
}
async function api(path) {
  const response = await fetch(API + path, {
    headers: { 'Authorization': 'Bearer ' + TOKEN,
      'Accept': 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28' },
    signal: AbortSignal.timeout(30000),
  });
  if (!response.ok) throw new Error('Storage GitHub read HTTP ' + response.status + ' for ' + path);
  return response.json();
}
async function findNext() {
  if (!TOKEN) throw Error('ACCESS_TOKEN required for storage repository access');
  if (requested && !idPattern.test(requested)) throw Error('Invalid requested upload ID');
  const root = await api('/git/trees/main');
  const folders = (root.tree || []).filter(t => t.type === 'tree' && /^library(?:_\d+)?$/.test(t.path));
  // Newest libraries first. Explicit requests still search every collection.
  folders.sort((a,b) => b.path.localeCompare(a.path, undefined, {numeric:true}));
  let candidates = [];
  for (const folder of folders) {
    const tree = await api('/git/trees/' + folder.sha);
    const index = (tree.tree || []).find(t => t.path === 'index.json' && t.type === 'blob');
    if (!index) continue;
    const blob = await api('/git/blobs/' + index.sha);
    if (blob.encoding !== 'base64' || !blob.content) throw Error('Invalid storage index encoding: ' + folder.path);
    const items = JSON.parse(Buffer.from(blob.content.replace(/\s/g,''), 'base64').toString('utf8'));
    if (!Array.isArray(items)) throw Error('Invalid storage index: ' + folder.path);
    for (const entry of items) if (eligible(entry, requested) && entry.previewPath.startsWith(folder.path + '/')) {
      candidates.push({ ...entry, collection: folder.path });
    }
    if (requested && candidates.length) break;
  }
  candidates.sort((a,b) => {
    const aPending = a.conversionStatus === 'pending' ? 1 : 0;
    const bPending = b.conversionStatus === 'pending' ? 1 : 0;
    return bPending-aPending || String(b.uploadedAt || '').localeCompare(String(a.uploadedAt || ''));
  });
  return candidates[0] || null;
}

if (process.argv[1] && /spine-link-project-queue\.mjs$/.test(process.argv[1])) {
  const selected = await findNext();
  const output = process.env.GITHUB_OUTPUT;
  // Dispatch may arrive after a temporary upload was deleted or another job
  // already exported it. That is an idempotent no-op, not a CI failure.
  if (requested && !selected) console.log('Skipping nonexistent, test-only, or already-completed upload: ' + requested);
  const lines = selected
    ? ['found=true', 'uploadId=' + selected.id, 'uploadPath=' + selected.previewPath,
        'projectFile=' + selected.projectFile]
    : ['found=false'];
  if (output) await fs.appendFile(output, lines.join('\n') + '\n');
  console.log(selected ? 'Selected Spine editor project: ' + selected.id + ' in ' + selected.collection :
    'No pending Spine editor projects in storage collections');
}
