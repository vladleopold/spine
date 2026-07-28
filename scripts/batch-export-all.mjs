#!/usr/bin/env node

import fs from 'node:fs';
import path from 'node:path';
import { execSync } from 'node:child_process';

const args = {
  mode: 'missing', // 'missing' or 'all'
  uploadId: '',
  origin: 'https://spine-link.vercel.app',
  basePath: 'library',
  repoPath: '.',
};

for (let i = 2; i < process.argv.length; i++) {
  const arg = process.argv[i];
  if (arg.startsWith('--mode=')) args.mode = arg.split('=')[1];
  else if (arg.startsWith('--upload-id=')) args.uploadId = arg.split('=')[1];
  else if (arg.startsWith('--origin=')) args.origin = arg.split('=')[1];
  else if (arg.startsWith('--base-path=')) args.basePath = arg.split('=')[1];
  else if (arg.startsWith('--repo-path=')) args.repoPath = arg.split('=')[1];
}

const repoRoot = path.resolve(args.repoPath);
const indexPath = path.join(repoRoot, args.basePath, 'index.json');

if (!fs.existsSync(indexPath)) {
  console.error(`Index not found at ${indexPath}`);
  process.exit(1);
}

let entries = JSON.parse(fs.readFileSync(indexPath, 'utf8'));

let targetEntries = [];

if (args.uploadId) {
  targetEntries = entries.filter((e) => e.id === args.uploadId);
} else if (args.mode === 'all') {
  targetEntries = entries;
} else {
  // 'missing'
  targetEntries = entries.filter((e) => !e.webmPreview || e.webmStatus !== 'ready');
}

console.log(`Found ${targetEntries.length} entries to export (mode: ${args.mode}, uploadId: ${args.uploadId || 'all'})`);

if (targetEntries.length === 0) {
  console.log('No entries to process.');
  process.exit(0);
}

function computeDuration(entry) {
  const uploadPath = entry.previewPath || path.posix.join(args.basePath, entry.id);
  const fullUploadPath = path.join(repoRoot, uploadPath);

  if (!fs.existsSync(fullUploadPath)) return 0;

  const setDirs = fs.readdirSync(fullUploadPath, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name);

  if (setDirs.length === 0) return 0;

  const setPath = path.join(fullUploadPath, setDirs[0]);
  const jsonFiles = fs.readdirSync(setPath).filter((f) => f.endsWith('.json'));
  if (jsonFiles.length === 0) return 0;

  const skeletonPath = path.join(setPath, jsonFiles[0]);
  const targetAnim = entry.defaultAnimation || (Array.isArray(entry.animations) ? entry.animations[0] : '');

  try {
    const data = JSON.parse(fs.readFileSync(skeletonPath, 'utf8'));
    const anim = data.animations && data.animations[targetAnim];
    if (!anim) return 0;
    let max = 0;
    const traverse = (obj) => {
      if (Array.isArray(obj)) {
        obj.forEach((item) => {
          if (item && typeof item.time === 'number' && item.time > max) max = item.time;
        });
      } else if (obj && typeof obj === 'object') {
        Object.values(obj).forEach(traverse);
      }
    };
    traverse(anim);
    return max > 0 ? parseFloat(max.toFixed(4)) : 0;
  } catch {
    return 0;
  }
}

let successCount = 0;
let failCount = 0;

for (let i = 0; i < targetEntries.length; i++) {
  const entry = targetEntries[i];
  console.log(`\n[${i + 1}/${targetEntries.length}] Processing ${entry.id} (${entry.title || 'untitled'})...`);

  const animName = entry.defaultAnimation || (Array.isArray(entry.animations) ? entry.animations[0] : '');
  if (!animName) {
    console.error(`  Skipping ${entry.id}: no animations defined.`);
    failCount++;
    continue;
  }

  const animDuration = computeDuration(entry);
  const uploadPath = entry.previewPath || path.posix.join(args.basePath, entry.id);
  const fullUploadDir = path.join(repoRoot, uploadPath);
  const webmOutputPath = path.join(fullUploadDir, 'preview.webm');

  console.log(`  Target animation: ${animName}, duration: ${animDuration}s`);

  try {
    execSync(
      `node scripts/spine-export-webm.mjs` +
        ` --upload-id="${entry.id}"` +
        ` --animation="${animName}"` +
        ` --origin="${args.origin}"` +
        ` --repo-path="${repoRoot}"` +
        ` --base-path="${args.basePath}"` +
        ` --anim-duration="${animDuration}"` +
        ` --output="${webmOutputPath}"`,
      { stdio: 'inherit', cwd: repoRoot }
    );

    if (fs.existsSync(webmOutputPath) && fs.statSync(webmOutputPath).size > 100) {
      const now = new Date().toISOString();
      const webmBuffer = fs.readFileSync(webmOutputPath);
      const chunkSize = webmBuffer.length;

      const chunk0Path = path.join(fullUploadDir, 'preview_chunk_0.webm');
      fs.copyFileSync(webmOutputPath, chunk0Path);

      const chunkMetaPath = path.join(fullUploadDir, 'preview_chunks.json');
      const webmUrl = `${args.origin}/assets/${uploadPath}/preview.webm`;
      const chunkUrl = `${args.origin}/assets/${uploadPath}/preview_chunk_0.webm`;

      const chunkMeta = {
        uploadId: entry.id,
        animation: animName,
        animationDuration: animDuration,
        chunkCount: 1,
        totalBytes: chunkSize,
        chunks: [
          {
            index: 0,
            path: `${uploadPath}/preview_chunk_0.webm`,
            url: chunkUrl,
            bytes: chunkSize,
          },
        ],
        updatedAt: now,
      };
      fs.writeFileSync(chunkMetaPath, JSON.stringify(chunkMeta, null, 2));

      entry.webmStatus = 'ready';
      entry.webmPreview = webmUrl;
      entry.webmDuration = animDuration;
      entry.webmGeneratedAt = now;
      delete entry.webmError;

      successCount++;
      console.log(`  SUCCESS: WebM created for ${entry.id}`);
    } else {
      console.error(`  FAIL: WebM output file missing or empty for ${entry.id}`);
      entry.webmStatus = 'failed';
      entry.webmError = 'Export script did not produce valid video file';
      failCount++;
    }
  } catch (err) {
    console.error(`  ERROR processing ${entry.id}:`, err.message);
    entry.webmStatus = 'failed';
    entry.webmError = err.message;
    failCount++;
  }

  fs.writeFileSync(indexPath, JSON.stringify(entries, null, 2) + '\n');
}

console.log(`\n=== BATCH EXPORT FINISHED ===`);
console.log(`Processed: ${targetEntries.length}`);
console.log(`Success: ${successCount}`);
console.log(`Failed: ${failCount}`);
