export function previewRuntimeMinor(version) {
  const parts = String(version || '').split('.');
  if (parts[0] !== '4' || !['0', '1', '2', '3'].includes(parts[1])) return '';
  return '4.' + parts[1];
}
