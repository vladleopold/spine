export function cleanAssetVersion(value = '') {
  return String(value || '')
    .trim()
    .replace(/[^a-z0-9._-]/gi, '-')
    .replace(/-+/g, '-')
    .slice(0, 120);
}

export function assetVersionForEntry(entry = {}, fallback = '') {
  return cleanAssetVersion(
    entry?.sourceProof?.proofHash ||
      entry?.blockchainAnchor?.sourceProofHash ||
      entry?.blockchainAnchor?.anchorHash ||
      entry?.uploadedAt ||
      entry?.id ||
      fallback,
  );
}

// For WebM assets: use webmGeneratedAt so CDN cache is busted after each new generation
export function assetVersionForWebm(entry = {}) {
  const webmGeneratedAt = String(entry?.webmGeneratedAt || '').trim();
  if (webmGeneratedAt) return cleanAssetVersion(webmGeneratedAt);
  return assetVersionForEntry(entry, 'webm');
}

export function appendAssetVersion(url = '', version = '') {
  const cleanUrl = String(url || '').trim();
  const cleanVersion = cleanAssetVersion(version);
  if (!cleanUrl || !cleanVersion || /[?&]v=/i.test(cleanUrl) || !/\/assets\//i.test(cleanUrl)) return cleanUrl;
  return `${cleanUrl}${cleanUrl.includes('?') ? '&' : '?'}v=${encodeURIComponent(cleanVersion)}`;
}
