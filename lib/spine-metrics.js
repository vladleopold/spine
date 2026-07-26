export function sanitizeMetricId(value = '') {
  const id = String(value || '').trim();
  if (!id || id.length > 220 || /[<>"'\\/\0]/.test(id)) return '';
  return id;
}

export function sanitizeMetricIds(values = []) {
  const seen = new Set();
  const ids = [];
  for (const value of Array.isArray(values) ? values : []) {
    const id = sanitizeMetricId(value);
    if (!id || seen.has(id)) continue;
    seen.add(id);
    ids.push(id);
    if (ids.length >= 500) break;
  }
  return ids;
}

export function parseMetricsJson(text = '') {
  try {
    const parsed = text ? JSON.parse(text) : {};
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    return {};
  }
}

export function metricCountsForId(metrics, id, visitorHash = '') {
  const metricId = sanitizeMetricId(id);
  const entry = metricId && metrics?.entries && typeof metrics.entries === 'object' ? metrics.entries[metricId] : null;
  const likedBy = entry?.likedBy && typeof entry.likedBy === 'object' ? entry.likedBy : {};
  return {
    likes: Math.max(0, Number(entry?.likes || 0) || 0),
    views: Math.max(0, Number(entry?.views || 0) || 0),
    liked: Boolean(visitorHash && likedBy[visitorHash]),
  };
}

export function metricCountsForIds(metrics, ids = [], visitorHash = '') {
  return sanitizeMetricIds(ids).reduce((result, id) => {
    result[id] = metricCountsForId(metrics, id, visitorHash);
    return result;
  }, {});
}
