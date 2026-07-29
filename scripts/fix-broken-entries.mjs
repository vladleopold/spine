#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

const indexPath = process.argv[2] || 'library/index.json';
const dryRun = process.argv.includes('--dry-run');
const verbose = process.argv.includes('--verbose');

const index = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
let fixes = 0;
let errors = 0;

for (const entry of index) {
  const id = entry.id || '';
  const entryDir = path.join('library', id);
  const files = Array.isArray(entry.files) ? [...entry.files] : [];
  const originalFiles = [...files];
  let changed = false;

  if (!entry.skeleton || !entry.atlas) continue;

  const skelName = path.basename(entry.skeleton);
  const atlasName = path.basename(entry.atlas);
  const skelStem = skelName.replace(/\.(json|skel)$/i, '');

  const setDir = path.join(entryDir, skelStem);
  const hasSetDir = fs.existsSync(setDir) && fs.statSync(setDir).isDirectory();

  if (!hasSetDir) continue;

  const actualFiles = fs.readdirSync(setDir);

  const expectedSkel = [skelName, `${skelStem}.skel`, `${skelStem}.json`];
  const expectedAtlas = [atlasName, `${skelStem}.atlas`];
  const expectedTextures = actualFiles.filter(f => /\.(png|webp|jpe?g)$/i.test(f));

  const setPrefix = `${skelStem}/`;

  for (const ef of [...files]) {
    if (ef === skelStem || ef === setPrefix.slice(0, -1)) {
      const idx = files.indexOf(ef);
      files.splice(idx, 1);
      changed = true;
      if (verbose) console.log(`  [${id}] Removed bare directory reference: ${ef}`);
    }
  }

  for (const exp of expectedSkel) {
    const fullRef = `${skelStem}/${exp}`;
    if (!files.some(f => f === exp || f === fullRef) && actualFiles.includes(exp)) {
      files.push(fullRef);
      changed = true;
      if (verbose) console.log(`  [${id}] Added missing skeleton ref: ${fullRef}`);
    }
  }

  for (const exp of expectedAtlas) {
    const fullRef = `${skelStem}/${exp}`;
    if (!files.some(f => f === exp || f === fullRef) && actualFiles.includes(exp)) {
      files.push(fullRef);
      changed = true;
      if (verbose) console.log(`  [${id}] Added missing atlas ref: ${fullRef}`);
    }
  }

  for (const tex of expectedTextures) {
    const fullRef = `${skelStem}/${tex}`;
    if (!files.some(f => f === tex || f === fullRef)) {
      files.push(fullRef);
      changed = true;
      if (verbose) console.log(`  [${id}] Added missing texture ref: ${fullRef}`);
    }
  }

  if (changed) {
    entry.files = files;
    fixes++;
    console.log(`FIXED [${id}]: files array updated (${originalFiles.length} -> ${files.length})`);
  }
}

if (fixes > 0 && !dryRun) {
  fs.writeFileSync(indexPath, JSON.stringify(index, null, 2));
  console.log(`\nWrote ${fixes} fixes to ${indexPath}`);
} else if (fixes > 0) {
  console.log(`\n[dry-run] Would fix ${fixes} entries`);
} else {
  console.log('No broken entries found.');
}
