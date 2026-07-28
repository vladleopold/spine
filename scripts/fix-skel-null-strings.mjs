import fs from 'fs';
import path from 'path';

class SpineBinaryCursor {
  constructor(bytes) {
    this.bytes = bytes;
    this.index = 0;
  }
  readByte() { return this.bytes[this.index++] ?? 0; }
  skip(length) { this.index += length; }
  readInt(optimizePositive) {
    let byte = this.readByte();
    let result = byte & 0x7f;
    if ((byte & 0x80) !== 0) {
      byte = this.readByte(); result |= (byte & 0x7f) << 7;
      if ((byte & 0x80) !== 0) {
        byte = this.readByte(); result |= (byte & 0x7f) << 14;
        if ((byte & 0x80) !== 0) {
          byte = this.readByte(); result |= (byte & 0x7f) << 21;
          if ((byte & 0x80) !== 0) {
            byte = this.readByte(); result |= (byte & 0x7f) << 28;
          }
        }
      }
    }
    return optimizePositive ? result : (result >>> 1) ^ -(result & 1);
  }
  readStringMeta() {
    const start = this.index;
    const byteCount = this.readInt(true);
    const contentStart = this.index;
    if (byteCount === 0) return { start, end: this.index, value: null };
    if (byteCount === 1) return { start, end: this.index, value: "" };
    this.skip(byteCount - 1);
    return {
      start, end: this.index,
      value: new TextDecoder().decode(this.bytes.slice(contentStart, this.index)),
    };
  }
}

function encodeSpineBinaryString(value) {
  const textBytes = new TextEncoder().encode(value);
  const byteCount = textBytes.length + 1;
  const lengthBytes = [];
  let remaining = byteCount;
  while (true) {
    let byte = remaining & 0x7f;
    remaining >>>= 7;
    if (remaining) byte |= 0x80;
    lengthBytes.push(byte);
    if (!remaining) break;
  }
  return new Uint8Array([...lengthBytes, ...textBytes]);
}

function replaceByteRanges(bytes, replacements) {
  if (!replacements.length) return bytes;
  const sorted = [...replacements].sort((a, b) => a.start - b.start);
  const nextLength = sorted.reduce((length, replacement) => length - (replacement.end - replacement.start) + replacement.bytes.length, bytes.length);
  const nextBytes = new Uint8Array(nextLength);
  let sourceIndex = 0, targetIndex = 0;
  for (const replacement of sorted) {
    nextBytes.set(bytes.slice(sourceIndex, replacement.start), targetIndex);
    targetIndex += replacement.start - sourceIndex;
    nextBytes.set(replacement.bytes, targetIndex);
    targetIndex += replacement.bytes.length;
    sourceIndex = replacement.end;
  }
  nextBytes.set(bytes.slice(sourceIndex), targetIndex);
  return nextBytes;
}

function sanitizedSkelBuffer(buffer, version = "") {
  const bytes = new Uint8Array(buffer);
  let isPatched = false;
  
  if (/^3\./.test(version)) {
    const patchCursor = new SpineBinaryCursor(new Uint8Array(bytes));
    try {
      patchCursor.readStringMeta(); 
      patchCursor.readStringMeta(); 
      patchCursor.skip(16);         
      const imagesPathPos = patchCursor.index;
      if (bytes[imagesPathPos] === 0x00) { bytes[imagesPathPos] = 0x01; isPatched = true; }
      patchCursor.readStringMeta(); 
      const audioPathPos = patchCursor.index;
      if (bytes[audioPathPos] === 0x00) { bytes[audioPathPos] = 0x01; isPatched = true; }
    } catch {}
  }

  const cursor = new SpineBinaryCursor(bytes);
  const replacements = [];
  try {
    if (/^3\./.test(version)) {
      cursor.readStringMeta(); cursor.readStringMeta();
    } else {
      cursor.skip(8); cursor.readStringMeta(); cursor.skip(4);
    }
    cursor.skip(16);
    const nonessential = cursor.readByte() !== 0;
    if (nonessential) {
      cursor.skip(4); cursor.readStringMeta(); cursor.readStringMeta();
    }
    const stringCount = cursor.readInt(true);
    for (let index = 0; index < stringCount; index += 1) cursor.readStringMeta();
    const boneCount = cursor.readInt(true);
    for (let index = 0; index < boneCount; index += 1) {
      const name = cursor.readStringMeta();
      if (!name.value) {
        replacements.push({
          start: name.start, end: name.end,
          bytes: encodeSpineBinaryString(`__placeholder_bone_${index}`),
        });
        isPatched = true;
      }
      if (index > 0) cursor.readInt(true);
      cursor.skip(32); cursor.readInt(true); cursor.skip(1);
      if (nonessential) cursor.skip(4);
    }
    // If parsing completes without errors, apply the replacements
    return { buffer: Buffer.from(replaceByteRanges(bytes, replacements)), isPatched };
  } catch {
    // If parsing failed halfway, the replacements array might contain garbage from misaligned reads.
    return { buffer: Buffer.from(bytes), isPatched };
  }
}

function spineBinaryVersionFromBuffer(buffer) {
  const bytes = new Uint8Array(buffer);
  const legacyCursor = new SpineBinaryCursor(bytes);
  try {
    legacyCursor.readStringMeta();
    const version = legacyCursor.readStringMeta().value || "";
    if (/^\d+\.\d+(?:\.|$)/.test(version)) return version;
  } catch {}
  const cursor = new SpineBinaryCursor(bytes);
  try {
    cursor.skip(8);
    return cursor.readStringMeta().value || "";
  } catch { return ""; }
}

const libDir = process.argv[2];
const isDryRun = process.argv.includes('--dry-run');

if (!libDir || !fs.existsSync(libDir)) {
  console.error("Usage: node fix-skel-null-strings.mjs <directory> [--dry-run]");
  process.exit(1);
}

let fixed = 0; let skipped = 0; let errors = 0;
console.log(`Scanning ${libDir}... ${isDryRun ? '(DRY RUN)' : ''}`);

function scan(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) scan(fullPath);
    else if (entry.name.toLowerCase().endsWith('.skel')) {
      try {
        const buf = fs.readFileSync(fullPath);
        const version = spineBinaryVersionFromBuffer(buf);
        const { buffer: newBuf, isPatched } = sanitizedSkelBuffer(buf, version);
        
        if (isPatched) {
          console.log(`[FIX] ${fullPath} (v${version})`);
          if (!isDryRun) fs.writeFileSync(fullPath, newBuf);
          fixed++;
        } else {
          skipped++;
        }
      } catch (e) {
        console.error(`[ERROR] ${fullPath}: ${e.message}`);
        errors++;
      }
    }
  }
}
scan(libDir);
console.log(`\nDone. Fixed: ${fixed}, Skipped: ${skipped}, Errors: ${errors}`);
