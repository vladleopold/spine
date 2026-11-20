import { escapeWorkflowCommandValue } from './export-log-redaction.mjs';

const SENSITIVE_KEYS = /(^|_)(?:ids?|paths?|files?|names?|animations?|sources?|fingerprints?|urls?|owners?|repos?|atlases?|textures?)(_|$)/i;

function normalizeKey(key) {
  return String(key).replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

function addValue(values, value) {
  if (typeof value !== 'string' || /[\r\n]/.test(value) || value.length === 0) return;
  values.add(value);
  const trimmed = value.trim();
  if (trimmed && trimmed !== value) values.add(trimmed);
  if (!/^https?:/i.test(value) && value.includes('/')) {
    for (const part of value.split('/')) {
      if (!part) continue;
      values.add(part);
      const normalized = part.trim();
      if (normalized && normalized !== part) values.add(normalized);
    }
  }
}

export function collectPreviewManifestSecrets(manifest, rawManifest = '', environment = {}) {
  const values = new Set();
  addValue(values, rawManifest);

  function visit(value, key = '') {
    if (Array.isArray(value)) {
      for (const item of value) visit(item, key);
      return;
    }
    if (value && typeof value === 'object') {
      for (const [childKey, child] of Object.entries(value)) visit(child, childKey);
      return;
    }
    if (typeof value === 'string' && SENSITIVE_KEYS.test(normalizeKey(key))) {
      addValue(values, value);
    }
  }

  visit(manifest);
  for (const key of [
    'ENTRY_ID', 'UPLOAD_ID', 'ENTRY_PATH', 'PREVIEW_PATH',
    'ENTRY_ANIMATION', 'ANIMATION', 'SOURCE_PATH',
    'ORIGIN', 'OWNER', 'REPO', 'BRANCH', 'SPINE_ANIMATION_SAFE',
  ]) addValue(values, environment[key]);

  return [...values];
}

export function previewManifestMaskCommands(manifest, rawManifest = '', environment = {}) {
  return collectPreviewManifestSecrets(manifest, rawManifest, environment)
    .map(value => '::add-mask::' + escapeWorkflowCommandValue(value) + '\n')
    .join('');
}
