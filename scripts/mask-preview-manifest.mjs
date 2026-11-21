#!/usr/bin/env node
import { previewManifestMaskCommands } from './lib/preview-manifest-redaction.mjs';

const raw = process.env.REPAIR_IDS_JSON || '';
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
