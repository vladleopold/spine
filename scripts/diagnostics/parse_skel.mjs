import fs from 'node:fs';

const inputPath = process.argv[2];
if (!inputPath) {
  console.error('Usage: node scripts/diagnostics/parse_skel.mjs <local-skel-path>');
  process.exit(2);
}

const buf = fs.readFileSync(inputPath);

function readString(buffer, offset) {
  const len = buffer.readUInt8(offset);
  if (len === 0) return { val: null, next: offset + 1 };
  let actualLen = len - 1;
  if (len & 0x80) {
    actualLen = (len & 0x7F) | (buffer.readUInt8(offset + 1) << 7);
    return { val: buffer.toString('utf8', offset + 2, offset + 2 + actualLen), next: offset + 2 + actualLen };
  }
  return { val: buffer.toString('utf8', offset + 1, offset + 1 + actualLen), next: offset + 1 + actualLen };
}

const { next: stringEnd } = readString(buf, 0);
const { next: headerEnd } = readString(buf, stringEnd);
const legacyWidth = buf.readFloatLE(headerEnd);
const legacyHeight = buf.readFloatLE(headerEnd + 4);
const x = buf.readFloatLE(headerEnd);
const y = buf.readFloatLE(headerEnd + 4);
const width = buf.readFloatLE(headerEnd + 8);
const height = buf.readFloatLE(headerEnd + 12);

console.log('Binary skeleton header parsed.');
console.log('Legacy dimensions:', legacyWidth, legacyHeight);
console.log('Bounds:', x, y, width, height);
