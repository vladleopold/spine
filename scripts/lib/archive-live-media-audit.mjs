export const ARCHIVE_MEDIA_TIERS = Object.freeze([
  Object.freeze({ tier: 'high', webmKey: 'webmPreview', posterKey: 'webpPoster', webmName: 'preview.webm' }),
  Object.freeze({ tier: 'medium', webmKey: 'webmPreviewMedium', posterKey: 'webpPosterMedium', webmName: 'preview-medium.webm' }),
  Object.freeze({ tier: 'low', webmKey: 'webmPreviewLow', posterKey: 'webpPosterLow', webmName: 'preview-low.webm' }),
]);

export function classifyArchiveEntryStatus(entry) {
  const webmStatus = typeof entry?.webmStatus === 'string' ? entry.webmStatus : '';
  const previewStatus = typeof entry?.previewStatus === 'string' ? entry.previewStatus : '';

  if (webmStatus === 'failed' || webmStatus === 'error' || previewStatus === 'failed') return 'failed';
  if (webmStatus.startsWith('blocked-') || previewStatus === 'blocked' ||
      webmStatus === 'pending' || previewStatus === 'pending') return 'blocked';
  if (webmStatus === 'ready') return previewStatus === 'ready' ? 'ready' : 'failed';
  return 'not-ready';
}

export function selectArchiveMediaPreflight(candidates, maxFolders = 4) {
  const selected = [];
  const seenFolders = new Set();
  const limit = Math.max(0, Number(maxFolders) || 0);
  if (limit === 0) return selected;

  const ordered = (Array.isArray(candidates) ? [...candidates] : [])
    .sort((left, right) => Number(right?.status === 'ready') - Number(left?.status === 'ready'));

  for (const candidate of ordered) {
    const folder = String(candidate?.folder || '');
    if (seenFolders.has(folder)) continue;
    const pairs = Array.isArray(candidate?.pairs) ? candidate.pairs : [];
    const pair = pairs.find((item) => item?.tier === 'high') || pairs[0];
    if (!pair) continue;

    selected.push({
      slot: candidate.slot,
      folder,
      previewPath: candidate.previewPath,
      ...pair,
    });
    seenFolders.add(folder);
    if (selected.length >= limit) break;
  }

  return selected;
}

export function shouldRunArchiveMediaAudit(originStatus, preflightResults, candidateCount) {
  if (classifyArchiveMediaHttpStatus(originStatus) === 'ok') return Number(candidateCount) > 0;
  if (!(Number(candidateCount) > 0)) return false;
  return (Array.isArray(preflightResults) ? preflightResults : []).some((result) =>
    result?.ok === true || result?.classification === 'failed');
}

export function listVisibleArchiveEntries(collections) {
  const result = [];
  for (const collection of Array.isArray(collections) ? collections : []) {
    if (!Array.isArray(collection?.entries)) continue;
    for (const entry of collection.entries) {
      if (!entry || typeof entry.id !== 'string' || !entry.id) continue;
      if (entry.hiddenFromPublicLibrary === true || entry.testOnly === true) continue;
      const previews = entry.allAnimationPreviews;
      const hasPreviewMetadata = Boolean(
        entry.webmPreview || entry.webmPreviewMedium || entry.webmPreviewLow ||
        entry.webpPoster || entry.webpPosterMedium || entry.webpPosterLow ||
        entry.thumbnail || entry.thumbnailPoster ||
        (previews && typeof previews === 'object' && !Array.isArray(previews) && Object.keys(previews).length > 0)
      );
      if (!hasPreviewMetadata) continue;
      result.push({ folder: String(collection.folder || ''), entry });
    }
  }
  return result;
}

function posterBasename(value) {
  try {
    const name = decodeURIComponent(new URL(value).pathname.split('/').pop() || '');
    return name.toLowerCase().endsWith('.webp') ? name : '';
  } catch {
    return '';
  }
}

// The indexed default is the only animation identity accepted here. If an
// allAnimationPreviews map exists, a missing exact key is blocked; legacy
// work-level fields are considered only when that map is absent.
export function resolveExactArchiveMedia(entry) {
  const animation = typeof entry?.defaultAnimation === 'string' ? entry.defaultAnimation : '';
  if (!animation) return { ok: false, reason: 'MISSING_DEFAULT_ANIMATION' };

  const hasMap = Boolean(entry?.allAnimationPreviews &&
    typeof entry.allAnimationPreviews === 'object' &&
    !Array.isArray(entry.allAnimationPreviews));
  const selected = hasMap
    ? (Object.hasOwn(entry.allAnimationPreviews, animation) ? entry.allAnimationPreviews[animation] : null)
    : entry;
  if (!selected || typeof selected !== 'object') {
    return { ok: false, reason: 'MISSING_EXACT_ANIMATION_MEDIA' };
  }

  const pairs = [];
  const incompleteTiers = [];
  const invalidTiers = [];
  for (const tier of ARCHIVE_MEDIA_TIERS) {
    const webm = typeof selected[tier.webmKey] === 'string' ? selected[tier.webmKey] : '';
    let poster = typeof selected[tier.posterKey] === 'string' ? selected[tier.posterKey] : '';
    if (!hasMap && tier.tier === 'high' && !poster &&
        typeof selected.thumbnailPoster === 'string') {
      poster = selected.thumbnailPoster;
    }

    const hasWebm = Boolean(webm);
    const hasPoster = Boolean(poster);
    if (!hasWebm && !hasPoster) continue;
    if (hasWebm !== hasPoster) {
      incompleteTiers.push(tier.tier);
      continue;
    }

    const posterName = posterBasename(poster);
    if (!posterName) {
      invalidTiers.push(tier.tier);
      continue;
    }
    pairs.push({
      tier: tier.tier,
      webm,
      poster,
      webmName: tier.webmName,
      posterName,
    });
  }

  if (!pairs.length) {
    if (incompleteTiers.length) {
      return { ok: false, reason: 'INCOMPLETE_EXACT_MEDIA_PAIR', animation, incompleteTiers, invalidTiers };
    }
    if (invalidTiers.length) {
      return { ok: false, reason: 'NON_WEBP_POSTER', animation, incompleteTiers, invalidTiers };
    }
    return { ok: false, reason: 'MISSING_EXACT_MEDIA_PAIR', animation };
  }
  return { ok: true, animation, pairs, incompleteTiers, invalidTiers };
}

export function validateArchiveMediaUrl(value, origin, previewPath, filename) {
  try {
    const parsed = new URL(value);
    const relative = String(previewPath || '').replace(/\\/g, '/');
    if (!relative || relative.startsWith('/') || relative.split('/').includes('..')) return false;
    return parsed.origin === origin &&
      decodeURIComponent(parsed.pathname) === '/assets/' + relative + '/' + filename;
  } catch {
    return false;
  }
}

export function classifyArchiveMediaHttpStatus(status) {
  const code = Number(status);
  if (code === 200 || code === 206) return 'ok';
  if (code === 0 || [401, 402, 403, 408, 425, 429].includes(code) || code >= 500) return 'blocked';
  return 'failed';
}

export function hasWebmSignature(bytes) {
  return Boolean(bytes && bytes.length > 128 &&
    bytes[0] === 0x1a && bytes[1] === 0x45 && bytes[2] === 0xdf && bytes[3] === 0xa3);
}

export function hasWebpSignature(bytes) {
  return Boolean(bytes && bytes.length > 128 &&
    bytes[0] === 0x52 && bytes[1] === 0x49 && bytes[2] === 0x46 && bytes[3] === 0x46 &&
    String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP');
}
