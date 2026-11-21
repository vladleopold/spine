import fs from 'node:fs';

const inputPath = process.argv[2];
if (!inputPath) {
  console.error('Usage: node scripts/diagnostics/parse_skel.js <local-skel-path>');
  process.exit(2);
}

const buffer = fs.readFileSync(inputPath);
console.log('Header bytes:', buffer.subarray(0, 64).toString('hex').match(/../g).join(' '));
console.log('ASCII signature:', buffer.subarray(0, 64).toString('ascii').replace(/[^a-zA-Z0-9.\\-]/g, '.'));
