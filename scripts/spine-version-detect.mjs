import fs from 'node:fs';
import path from 'node:path';

// Modern Spine binary exports begin with an 8-byte fixed hash, followed by
// a varint-length-prefixed UTF-8 version. Older exports use two strings:
// hash, then version. Do not interpret the hash as a string.
function readVarint(bytes, offset) {
  let value = 0;
  for (let i = 0; i < 5; i++) {
    if (offset >= bytes.length) return null;
    const byte = bytes[offset++];
    value |= (byte & 127) << (i * 7);
    if (!(byte & 128)) return { value: value >>> 0, next: offset };
  }
  return null;
}

function readString(bytes, offset) {
  const count = readVarint(bytes, offset);
  if (!count || count.value > 96) return null;
  if (count.value === 0) return { value: null, next: count.next };
  if (count.value === 1) return { value: '', next: count.next };
  const end = count.next + count.value - 1;
  if (end > bytes.length) return null;
  const value = Buffer.from(bytes.subarray(count.next, end)).toString('utf8');
  if (value.includes('\uFFFD')) return null;
  return { value, next: end };
}

const VERSION_RE = /^(?:[1-9]\d?)\.\d{1,2}(?:\.\d{1,3})?(?:-[a-z0-9.-]+)?$/i;
function validVersion(value) {
  return typeof value === 'string' && VERSION_RE.test(value.trim());
}

export function detectBinarySpineVersion(bytes) {
  if (!bytes || bytes.length < 10) return 'unknown';
  // Spine >= 4.0: 8-byte numeric hash, then version string.
  const modern = readString(bytes, 8);
  if (modern && validVersion(modern.value)) return modern.value.trim();

  // Older Spine: variable-length hash string and version string.
  const oldHash = readString(bytes, 0);
  const legacy = oldHash && readString(bytes, oldHash.next);
  if (legacy && validVersion(legacy.value)) return legacy.value.trim();

  // Some exports include an additional prefix. Search only the header, not
  // animation/string-table data, so a filename cannot impersonate a version.
  const header = Buffer.from(bytes.subarray(0, Math.min(64, bytes.length))).toString('latin1');
  const found = header.match(/(?:^|[^a-z0-9.])([1-9]\d?\.\d{1,2}(?:\.\d{1,3})?(?:-[a-z0-9.-]+)?)(?=$|[^a-z0-9.-])/i);
  return found && validVersion(found[1]) ? found[1] : 'unknown';
}

export function detectSkeletonVersion(filePath) {
  try {
    if (path.extname(filePath).toLowerCase() === '.json') {
      const data = JSON.parse(fs.readFileSync(filePath, 'utf8'));
      const value = String(data?.skeleton?.spine || '');
      return validVersion(value) ? value.trim() : 'unknown';
    }
    if (path.extname(filePath).toLowerCase() === '.skel') {
      const descriptor = fs.openSync(filePath, 'r');
      try {
        const head = Buffer.alloc(256);
        const n = fs.readSync(descriptor, head, 0, head.length, 0);
        return detectBinarySpineVersion(head.subarray(0, n));
      } finally {
        fs.closeSync(descriptor);
      }
    }
  } catch {}
  return 'unknown';
}
