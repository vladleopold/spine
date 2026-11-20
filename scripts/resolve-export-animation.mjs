import fs from 'node:fs';
import { entryForUpload } from './resolve-library.mjs';
import { resolveAnimationIndex } from './lib/spine-export-matrix.mjs';
import { escapeWorkflowCommandValue } from './lib/export-log-redaction.mjs';

const uploadId = String(process.env.UPLOAD_ID || '');
const indexValue = process.env.ANIMATION_INDEX;
const found = uploadId ? entryForUpload(process.cwd(), uploadId) : null;
const selection = found
  ? resolveAnimationIndex(found.entry, indexValue)
  : { status: 'blocked', reason: 'upload-not-found' };

if (selection.status !== 'ready') {
  console.error(selection.reason || 'animation-index-unavailable');
  process.exit(1);
}

if (!process.env.GITHUB_ENV || !process.env.GITHUB_OUTPUT) {
  console.error('github-output-unavailable');
  process.exit(1);
}

process.stdout.write('::add-mask::' + escapeWorkflowCommandValue(uploadId) + '\n');
process.stdout.write('::add-mask::' + escapeWorkflowCommandValue(selection.animation) + '\n');
const encodedAnimation = Buffer.from(selection.animation, 'utf8').toString('base64');
fs.appendFileSync(
  process.env.GITHUB_ENV,
  `SPINE_ANIMATION_B64=${encodedAnimation}\nSPINE_ANIMATION_SAFE=${selection.safeName}\n`,
);
fs.appendFileSync(process.env.GITHUB_OUTPUT, `safe_name=${selection.safeName}\n`);
process.stdout.write('ANIMATION_INDEX_RESOLVED\n');
