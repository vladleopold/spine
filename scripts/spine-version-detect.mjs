import fs from 'node:fs';
import path from 'node:path';
import { readSpineSkeletonDocument } from './lib/spine-skeleton-document.mjs';

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

  // Some exports (notably Unity TextAsset wrappers around Spine JSON) add a
  // textual container before the embedded skeleton metadata. The version can
  // therefore sit beyond byte 64. Inspect a bounded 256-byte header only; do
  // not search animation/string-table data, so later content cannot impersonate
  // the serialized Spine version.
  const header = Buffer.from(bytes.subarray(0, Math.min(256, bytes.length))).toString('latin1');
  const found = header.match(/(?:^|[^a-z0-9.])([1-9]\d?\.\d{1,2}(?:\.\d{1,3})?(?:-[a-z0-9.-]+)?)(?=$|[^a-z0-9.-])/i);
  return found && validVersion(found[1]) ? found[1] : 'unknown';
}

export function detectSkeletonVersion(filePath) {
  try {
    const descriptor = fs.openSync(filePath, 'r');
    try {
      const bytes = fs.readFileSync(descriptor);
      const document = readSpineSkeletonDocument(bytes);
      if (document.format === 'json') {
        const value = String(document.data?.skeleton?.spine || '');
        return validVersion(value) ? value.trim() : 'unknown';
      }
      return detectBinarySpineVersion(bytes.subarray(0, 256));
    } finally {
      fs.closeSync(descriptor);
    }
  } catch {}
  return 'unknown';
}
