// Keep an explicit selection when it is actually present in the source's
// animated tracks. If it is missing/static, fall back to a deterministic
// source track for preview only; never rewrite defaultAnimation or source data.
export function choosePreviewAnimation(names, preferred = '') {
  const available = Array.isArray(names)
    ? names.filter(name => typeof name === 'string' && name.length > 0)
    : [];
  if (typeof preferred === 'string' && preferred.length > 0 &&
      (available.length === 0 || available.includes(preferred))) return preferred;
  return available.find(name => /^idle$/i.test(name)) ||
    available.find(name => /idle/i.test(name)) ||
    available[0] ||
    '';
}
