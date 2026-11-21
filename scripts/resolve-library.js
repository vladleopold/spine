#!/usr/bin/env node
// Resolves the active library collection folder that holds a Spine work.
//
// Works are spread across library_01, library_02, ... folders. The export
// workflows used to hardcode `library`, which stopped holding an index.json
// after the rename, so every export failed at checkout. The repository is
// already checked out when this runs, so every collection's index.json is
// available locally: scan them for the uploadId instead of guessing a path.
const fs = require('fs');
const path = require('path');

const repoRoot = process.argv[2] || process.cwd();
const uploadId = process.argv[3] || '';

function folderName(name) {
  return /^library(_\d+)?$/.test(String(name || ''));
}

function readEntries(folder) {
  const indexPath = path.join(repoRoot, folder, 'index.json');
  if (!fs.existsSync(indexPath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

const folders = fs.readdirSync(repoRoot)
  .filter(folderName)
  .sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));

// 1. Prefer the folder whose index.json contains this uploadId.
if (uploadId) {
  for (const folder of folders) {
    const entries = readEntries(folder);
    if (entries && entries.some(e => String(e && e.id) === uploadId)) {
      console.log(folder);
      process.exit(0);
    }
  }
}

// 2. Fallback: newest library_NN folder that has a non-empty index.json.
const numbered = folders.filter(f => /^library_\d+$/.test(f));
for (let i = numbered.length - 1; i >= 0; i--) {
  const entries = readEntries(numbered[i]);
  if (entries && entries.length) {
    console.log(numbered[i]);
    process.exit(0);
  }
}

// 3. Last resort: the bare `library` folder if it has an index.
if (folders.includes('library') && readEntries('library')) {
  console.log('library');
  process.exit(0);
}

console.log(folders[0] || 'library');
process.exit(0);
