#!/usr/bin/env node
/**
 * fix-skel-null-strings.mjs
 *
 * Patches Spine 3.8 binary .skel files that have a null "images path" string.
 * The Spine 3.8 binary format encodes strings as varint(charCount+1):
 *   0x00 → null  (INVALID - causes "String in string table must not be null")
 *   0x01 → ""    (empty string - valid)
 *
 * Header layout (Spine 3.8, big-endian floats):
 *   [hash string] [version string] [x:f32] [y:f32] [w:f32] [h:f32] [imagesPath string] [audioPath string]
 *
 * This script replaces 0x00 → 0x01 for imagesPath and audioPath in the header.
 */

import fs from 'node:fs';
import path from 'node:path';

const LIBRARY_DIR = process.argv[2] || 'library';
const DRY_RUN = process.argv.includes('--dry-run');

let fixed = 0, skipped = 0, errors = 0;

function readVarint(buf, pos) {
  let b = buf[pos++]; let result = b & 0x7F;
  if (b & 0x80) { b = buf[pos++]; result |= (b & 0x7F) << 7;
    if (b & 0x80) { b = buf[pos++]; result |= (b & 0x7F) << 14;
      if (b & 0x80) { b = buf[pos++]; result |= (b & 0x7F) << 21;
        if (b & 0x80) { b = buf[pos++]; result |= (b & 0x7F) << 28; } } } }
  return { value: result, pos };
}

function skipString(buf, pos) {
  const r = readVarint(buf, pos);
  const lenByte = r.value;
  pos = r.pos;
  const charCount = lenByte - 1;
  if (charCount <= 0) return pos; // null or empty - no bytes follow
  return pos + charCount;
}

function getStringLenBytePos(buf, pos) {
  // Returns the position of the varint length byte for the string
  return pos;
}

function fixSkelFile(filePath) {
  try {
    const buf = fs.readFileSync(filePath);

    // Read version string to confirm it's Spine 3.x
    let pos = 0;
    // Skip hash string
    pos = skipString(buf, pos);
    // Read version
    const verR = readVarint(buf, pos);
    const verLen = verR.value - 1;
    const verPos = verR.pos;
    if (verLen < 0) { skipped++; return; }
    const version = buf.toString('utf8', verPos, verPos + verLen);
    pos = verPos + verLen;

    if (!version.startsWith('3.')) {
      // Not Spine 3.x - skip (4.x has a different header layout)
      skipped++;
      return;
    }

    // Skip x, y, w, h floats (4 * 4 = 16 bytes)
    pos += 16;

    // Now we're at imagesPath string
    const imagesPathPos = pos;
    const imagesPathByte = buf[imagesPathPos];

    // audioPath is right after imagesPath
    const afterImagesPos = skipString(buf, imagesPathPos);
    const audioPathPos = afterImagesPos;
    const audioPathByte = buf[audioPathPos];

    const needsFix = imagesPathByte === 0x00 || audioPathByte === 0x00;

    if (!needsFix) {
      skipped++;
      return;
    }

    console.log(`[FIX] ${filePath} (v${version})`);
    console.log(`  imagesPath byte at ${imagesPathPos}: 0x${imagesPathByte.toString(16).padStart(2,'0')} ${imagesPathByte === 0x00 ? '→ 0x01 (null→empty)' : '(ok)'}`);
    console.log(`  audioPath byte at ${audioPathPos}: 0x${audioPathByte.toString(16).padStart(2,'0')} ${audioPathByte === 0x00 ? '→ 0x01 (null→empty)' : '(ok)'}`);

    if (!DRY_RUN) {
      const patched = Buffer.from(buf);
      if (imagesPathByte === 0x00) patched[imagesPathPos] = 0x01;
      if (audioPathByte === 0x00) patched[audioPathPos] = 0x01;
      fs.writeFileSync(filePath, patched);
      console.log(`  ✓ Patched.`);
    } else {
      console.log(`  (dry-run, not written)`);
    }
    fixed++;
  } catch (e) {
    console.error(`[ERROR] ${filePath}: ${e.message}`);
    errors++;
  }
}

function walkLibrary(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walkLibrary(fullPath);
    } else if (entry.name.endsWith('.skel')) {
      fixSkelFile(fullPath);
    }
  }
}

console.log(`Scanning ${LIBRARY_DIR}...${DRY_RUN ? ' (DRY RUN)' : ''}`);
walkLibrary(LIBRARY_DIR);
console.log(`\nDone. Fixed: ${fixed}, Skipped: ${skipped}, Errors: ${errors}`);
