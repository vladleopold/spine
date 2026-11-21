// Works are sharded across library_NN folders (one per ~999 uploads), and the
// active folder changes as the library rotates. Nothing hardcodes a folder
// name: these helpers find the folder that actually holds a given index, so a
// rotation needs no edit here.
import fs from 'node:fs';
import path from 'node:path';

// Every collection folder in the repo, ordered by number so `library_02`
// sorts before `library_10`. The bare `library` folder comes first because it
// predates the sharding.
export function listCollectionFolders(repoRoot) {
  let names;
  try {
    names = fs.readdirSync(repoRoot, { withFileTypes: true })
      .filter((d) => d.isDirectory() && /^library(_\d+)?$/.test(d.name))
      .map((d) => d.name);
  } catch {
    return [];
  }
  return names.sort((a, b) => a.localeCompare(b, 'en', { numeric: true }));
}

export function readIndex(repoRoot, basePath) {
  const file = path.join(repoRoot, basePath, 'index.json');
  if (!fs.existsSync(file)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8'));
    return Array.isArray(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

// Newest folder that holds an index — where new uploads land. Emptier
// placeholder folders created by a rotation carry no index and are skipped.
export function activeCollectionPath(repoRoot, fallback = 'library') {
  const folders = listCollectionFolders(repoRoot);
  for (let i = folders.length - 1; i >= 0; i -= 1) {
    if (readIndex(repoRoot, folders[i])) return folders[i];
  }
  return fallback;
}

// Folder that actually contains this upload. Ids are unique across shards, so
// the search is by id and not by position.
export function collectionPathForUpload(repoRoot, uploadId, fallback = 'library') {
  const folders = listCollectionFolders(repoRoot);
  for (const folder of folders) {
    const index = readIndex(repoRoot, folder);
    if (index && index.some((entry) => entry && entry.id === uploadId)) return folder;
  }
  return activeCollectionPath(repoRoot, fallback);
}

export function entryForUpload(repoRoot, uploadId) {
  for (const folder of listCollectionFolders(repoRoot)) {
    const index = readIndex(repoRoot, folder);
    const entry = index && index.find((item) => item && item.id === uploadId);
    if (entry) return { basePath: folder, entry, index };
  }
  return null;
}
