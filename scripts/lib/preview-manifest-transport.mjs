import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { previewManifestMaskCommands } from './preview-manifest-redaction.mjs';

function manifestIdentity(entries) {
  return entries.map((entry) => ({
    repairSlot: entry.repairSlot,
    id: entry.id,
    basePath: entry.basePath,
    previewPath: entry.previewPath,
    uploadedAt: entry.uploadedAt ?? null,
    sourceFingerprint: entry.sourceFingerprint ?? null,
    animation: entry.animation ?? '',
    needsRender: Boolean(entry.needsRender),
  }));
}

export function previewManifestDigest(entries) {
  return createHash('sha256').update(JSON.stringify(manifestIdentity(entries))).digest('hex');
}

export function applyFrozenRenderSlots(entries, rawSlots = '[]') {
  const slots = Array.isArray(rawSlots) ? rawSlots : JSON.parse(String(rawSlots || '[]'));
  if (!Array.isArray(slots)) throw new Error('Invalid frozen render-slot list');
  const available = new Set(entries.map((entry) => entry.repairSlot));
  const selected = new Set();
  for (const slot of slots) {
    if (!Number.isInteger(slot) || !available.has(slot) || selected.has(slot)) {
      throw new Error('Invalid frozen render-slot list');
    }
    selected.add(slot);
  }
  return entries.map((entry) => ({ ...entry, needsRender: selected.has(entry.repairSlot) }));
}

function githubEnvBlock(name, value) {
  const text = String(value ?? '');
  let delimiter = 'SPINE_PREVIEW_' + createHash('sha256')
    .update(name + '\0' + text).digest('hex').slice(0, 24);
  while (text.includes(delimiter)) delimiter += '_X';
  return name + '<<' + delimiter + '\n' + text + '\n' + delimiter + '\n';
}

function assertExpectedDigest(entries, expectedDigest) {
  const digest = previewManifestDigest(entries);
  if (!/^[a-f0-9]{64}$/i.test(String(expectedDigest || '')) || digest !== expectedDigest) {
    throw new Error('Frozen preview manifest changed between jobs');
  }
  return digest;
}

export function preparePreviewManifest(entries, expectedDigest) {
  const digest = assertExpectedDigest(entries, expectedDigest);
  const raw = JSON.stringify(entries);
  return {
    digest,
    maskCommands: previewManifestMaskCommands(entries, raw),
    envContent: githubEnvBlock('REPAIR_IDS_JSON', raw),
  };
}

export function preparePreviewSlot(entries, slotValue, expectedDigest) {
  const digest = assertExpectedDigest(entries, expectedDigest);
  const slot = Number(slotValue);
  const entry = entries.find((item) => item.repairSlot === slot);
  if (!entry) throw new Error('Frozen preview slot is unavailable');
  const raw = JSON.stringify(entries);
  const environment = {
    ENTRY_ID: entry.id,
    UPLOAD_ID: entry.id,
    ENTRY_PATH: entry.previewPath,
    PREVIEW_PATH: entry.previewPath,
    SOURCE_PATH: entry.previewPath,
    ENTRY_ANIMATION: entry.animation,
  };
  const envValues = {
    ENTRY_ID: entry.id,
    ENTRY_PATH: entry.previewPath,
    PREVIEW_PATH: entry.previewPath,
    ENTRY_ANIMATION: entry.animation,
    ENTRY_READY: String(Boolean(entry.ready)),
    ENTRY_NEEDS_RENDER: String(Boolean(entry.needsRender)),
    REPAIR_SLOT: String(entry.repairSlot),
  };
  return {
    digest,
    maskCommands: previewManifestMaskCommands(entries, raw, environment),
    envContent: Object.entries(envValues)
      .map(([name, value]) => githubEnvBlock(name, value))
      .join(''),
  };
}

export function writePreparedPreviewEnvironment(prepared, envFile) {
  if (!envFile) throw new Error('GitHub environment file is unavailable');
  process.stdout.write(prepared.maskCommands);
  fs.appendFileSync(envFile, prepared.envContent);
}
