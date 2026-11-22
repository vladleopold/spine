import fs from 'node:fs';
import path from 'node:path';
import { entryForUpload } from './resolve-library.mjs';
import { REQUIRED_EXPORT_PREVIEW_FILES, blockDefaultPreview, resolveIndexedExportAnimation, validateExportPreviewArtifact } from './lib/export-preview-artifact.mjs';
const root = process.cwd();
const artifactRoot = path.resolve(root, process.argv[2] || 'downloaded-artifacts');
if (!artifactRoot.startsWith(root + path.sep)) throw new Error('UNSAFE_ARTIFACT_ROOT');
const origin = 'https://spine-link.vercel.app';
const now = new Date().toISOString();
const summary = { received: 0, ready: 0, blocked: 0, skipped: 0, reasonCounts: {} };
const states = new Map();
function reason(code) {
  const safe = /^[A-Z0-9_]+$/.test(String(code || '')) ? String(code) : 'UNKNOWN';
  summary.reasonCounts[safe] = (summary.reasonCounts[safe] || 0) + 1;
}
function collect(rootDir) {
  if (!fs.existsSync(rootDir)) return [];
  const out = [];
  for (const name of fs.readdirSync(rootDir)) {
    const job = path.join(rootDir, name);
    if (!fs.statSync(job).isDirectory()) continue;
    const children = fs.readdirSync(job);
    const nested = children.filter((child) => fs.statSync(path.join(job, child)).isDirectory());
    if (nested.length) for (const child of nested) out.push({ id: child, dir: path.join(job, child) });
    else if (/^export-/.test(name)) out.push({ id: name.slice(7), dir: job });
  }
  return out;
}
function safePath(base, entry, id) {
  let relative = String(entry?.previewPath || path.posix.join(base, id));
  if (!relative || relative.startsWith('/') || relative.includes('\\')) return null;
  if (!/^library(?:_\d+)?\//.test(relative)) relative = path.posix.join(base, relative);
  if (relative.split('/').some((part) => !part || part === '.' || part === '..')) return null;
  const absolute = path.resolve(root, relative);
  return absolute.startsWith(root + path.sep) ? relative : null;
}
if (fs.existsSync(artifactRoot)) {
  for (const item of collect(artifactRoot)) {
    summary.received += 1;
    const found = entryForUpload(root, item.id);
    if (!found) { summary.skipped += 1; reason('INDEX_ENTRY_MISSING'); continue; }
    let state = states.get(found.basePath);
    if (!state) { state = { file: path.join(root, found.basePath, 'index.json'), entries: found.index, changed: false }; states.set(found.basePath, state); }
    const index = state.entries.findIndex((entry) => entry && entry.id === item.id);
    if (index < 0) { summary.skipped += 1; reason('INDEX_ENTRY_MISSING'); continue; }
    const entry = state.entries[index];
    const selection = resolveIndexedExportAnimation(entry);
    if (selection.status !== 'ready') {
      state.entries[index] = { ...blockDefaultPreview(entry, selection.reason), previewStatusGeneratedAt: now };
      state.changed = true; summary.blocked += 1; reason(selection.reason); continue;
    }
    let meta = null;
    try { meta = JSON.parse(fs.readFileSync(path.join(item.dir, 'meta.json'), 'utf8')); } catch { meta = null; }
    const media = new Map();
    const prefix = item.id + '-';
    for (const file of fs.readdirSync(item.dir)) {
      if (file === 'meta.json') continue;
      const clean = file.startsWith(prefix) ? file.slice(prefix.length) : file;
      if (REQUIRED_EXPORT_PREVIEW_FILES.includes(clean)) media.set(clean, fs.readFileSync(path.join(item.dir, file)));
    }
    const check = validateExportPreviewArtifact(entry, meta, media);
    if (!check.ok) { summary.skipped += 1; reason(check.reason); continue; }
    const previewPath = safePath(found.basePath, entry, item.id);
    if (!previewPath) { summary.skipped += 1; reason('UNSAFE_PREVIEW_PATH'); continue; }
    const target = path.resolve(root, previewPath);
    fs.mkdirSync(target, { recursive: true });
    for (const file of REQUIRED_EXPORT_PREVIEW_FILES) fs.writeFileSync(path.join(target, file), media.get(file));
    const encoded = previewPath.split('/').map(encodeURIComponent).join('/');
    const baseUrl = origin + '/assets/' + encoded + '/';
    const next = {
      ...entry,
      webmPreview: baseUrl + 'preview.webm', webmPreviewMedium: baseUrl + 'preview-medium.webm', webmPreviewLow: baseUrl + 'preview-low.webm',
      webpPoster: baseUrl + 'preview.webp', webpPosterMedium: baseUrl + 'preview-medium.webp', webpPosterLow: baseUrl + 'preview-low.webp',
      webmPreviewPath: previewPath + '/preview.webm', webmStatus: 'ready', webmGeneratedAt: now,
      previewWidth: Number(meta.width), previewHeight: Number(meta.height), previewDuration: Number(meta.animationDuration),
      ...(Number(meta.skeletonWidth) > 0 ? { skeletonWidth: Number(meta.skeletonWidth) } : {}),
      ...(Number(meta.skeletonHeight) > 0 ? { skeletonHeight: Number(meta.skeletonHeight) } : {}),
    };
    for (const key of ['webmError', 'previewError', 'webmChunksJson', 'webmChunks', 'webmChunkCount', 'webmIsChunked']) delete next[key];
    state.entries[index] = next; state.changed = true; summary.ready += 1;
  }
}
for (const state of states.values()) if (state.changed) fs.writeFileSync(state.file, JSON.stringify(state.entries, null, 2));
console.log('EXPORT_ARTIFACT_MERGE_SUMMARY=' + JSON.stringify(summary));