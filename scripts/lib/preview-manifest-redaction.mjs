import { escapeWorkflowCommandValue } from './export-log-redaction.mjs';

const SENSITIVE_KEYS = /(^|_)(?:ids?|paths?|files?|names?|animations?|sources?|fingerprints?|urls?|owners?|repos?|atlases?|textures?)(_|$)/i;

function normalizeKey(key) {
  return String(key).replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

function addValue(values, value) {
  if (typeof value !== 'string') return;
  const text = value.trim();
  if (text.length < 4 || /[\r\n]/.test(text)) return;
  values.add(text);
  if (!/^https?:/i.test(text) && text.includes('/')) {
    for (const part of text.split('/')) {
      if (part.length >= 4) values.add(part);
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
  ]) addValue(values, environment[key]);

  return [...values];
}

export function previewManifestMaskCommands(manifest, rawManifest = '', environment = {}) {
  return collectPreviewManifestSecrets(manifest, rawManifest, environment)
    .map(value => '::add-mask::' + escapeWorkflowCommandValue(value) + '\n')
    .join('');
}
