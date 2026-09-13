import fs from 'fs';
const buf = fs.readFileSync('library/bg_for_spine_05.04.2026_002-2026-05-05T21-32-51-474Z/bg_for_spine_05.04.2026_002/BG_For_Spine_05.04.2026_002.skel');
function readString(b, offset) {
  const len = b.readUInt8(offset);
  if (len === 0) return { val: null, next: offset + 1 };
  let actualLen = len - 1;
  if (len & 0x80) {
    actualLen = ((len & 0x7F) | (b.readUInt8(offset+1) << 7));
    return { val: b.toString('utf8', offset+2, offset+2+actualLen), next: offset+2+actualLen };
  }
  return { val: b.toString('utf8', offset+1, offset+1+actualLen), next: offset+1+actualLen };
}
let { val: hash, next: n1 } = readString(buf, 0);
let { val: ver, next: n2 } = readString(buf, n1);
console.log("Hash:", hash, "Ver:", ver);

const w3 = buf.readFloatLE(n2);
const h3 = buf.readFloatLE(n2+4);
console.log("3.8 parse -> w:", w3, "h:", h3);

const x = buf.readFloatLE(n2);
const y = buf.readFloatLE(n2+4);
const w = buf.readFloatLE(n2+8);
const h = buf.readFloatLE(n2+12);
console.log("4.x parse -> x:", x, "y:", y, "w:", w, "h:", h);
