export function exactPreviewAnimation(item, record, meta) {
  const requested = String(item?.animation || record?.defaultAnimation || '');
  const rendered = String(meta?.animation || '');
  if (!requested) return { ok: false, animation: '', reason: 'missing-index-selection' };
  if (rendered !== requested) return { ok: false, animation: requested, reason: 'rendered-animation-mismatch' };
  return { ok: true, animation: requested };
}
