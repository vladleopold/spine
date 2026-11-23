#!/usr/bin/env node
import fs from 'node:fs';
import { previewManifestEnvBlock, previewManifestMaskCommands } from './lib/preview-manifest-redaction.mjs';

const raw = process.env.REPAIR_IDS_FILE
  ? fs.readFileSync(process.env.REPAIR_IDS_FILE, 'utf8')
  : (process.env.REPAIR_IDS_JSON || '');
let manifest = null;
if (raw) {
  try {
    manifest = JSON.parse(raw);
  } catch {
    console.error('PREVIEW_MANIFEST_INVALID');
    process.exit(1);
  }
}

process.stdout.write(previewManifestMaskCommands(manifest, raw, process.env));
process.stdout.write('PREVIEW_METADATA_MASKED\n');
if (process.env.GITHUB_ENV && !process.env.REPAIR_IDS_FILE) {
  fs.appendFileSync(process.env.GITHUB_ENV, previewManifestEnvBlock(process.env), 'utf8');
}
