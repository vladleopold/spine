const SENSITIVE_KEY = /(^|_)(?:ids?|paths?|files?|names?|animations?|skeletons?|atlas(?:es)?|textures?|sources?|urls?|owners?|repos?|origins?|branch(?:es)?)(_|$)/i;

function normalizeKey(key) {
  return String(key).replace(/([a-z0-9])([A-Z])/g, '$1_$2').toLowerCase();
}

function addValue(values, value) {
  if (typeof value !== 'string') return;
  const text = value.trim();
  if (text.length < 2 || /[\r\n]/.test(text)) return;
  values.add(text);
  if (!/^https?:/i.test(text) && text.includes('/')) {
    for (const part of text.split('/')) {
      if (part.length >= 3) values.add(part);
    }
  }
}

export function collectSensitiveExportValues(entry) {
  const values = new Set();
  function visit(value, key = '', forceSensitive = false) {
    if (Array.isArray(value)) {
      for (const item of value) visit(item, key, forceSensitive || SENSITIVE_KEY.test(normalizeKey(key)));
      return;
    }
    if (value && typeof value === 'object') {
      const previewMap = forceSensitive || normalizeKey(key) === 'all_animation_previews';
      for (const [childKey, child] of Object.entries(value)) {
        if (previewMap) addValue(values, childKey);
        visit(child, childKey, previewMap || SENSITIVE_KEY.test(normalizeKey(childKey)));
      }
      return;
    }
    if (typeof value === 'string' &&
        (forceSensitive || SENSITIVE_KEY.test(normalizeKey(key)))) {
      addValue(values, value);
    }
  }
  visit(entry);
  return [...values];
}

export function escapeWorkflowCommandValue(value) {
  return String(value)
    .replace(/%/g, '%25')
    .replace(/\r/g, '%0D')
    .replace(/\n/g, '%0A');
}
