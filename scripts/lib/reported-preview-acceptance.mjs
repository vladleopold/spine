function baseName(value) {
  return String(value || '').replace(/\\/g, '/').split('/').pop();
}

function productionAsset(url, extension) {
  if (typeof url !== 'string' ||
      !url.startsWith('https://spine-link.vercel.app/assets/')) return false;
  const pathname = url.split('?')[0];
  return pathname.toLowerCase().endsWith('.' + extension);
}

function parentPath(url) {
  const pathname = String(url || '').split('?')[0];
  return pathname.slice(0, pathname.lastIndexOf('/'));
}

export function sourceBlocker(record, requestedAnimation = '', availableFiles = null) {
  if (!record || typeof record.skeleton !== 'string' || !record.skeleton ||
      typeof record.atlas !== 'string' || !record.atlas ||
      !Array.isArray(record.textures) || record.textures.length === 0) {
    return 'missing-source';
  }

  const selected = typeof requestedAnimation === 'string' && requestedAnimation.length > 0
    ? requestedAnimation
    : typeof record.defaultAnimation === 'string' ? record.defaultAnimation : '';
  if (!selected) return 'missing-animation-selection';

  if (availableFiles instanceof Map) {
    const expected = [record.skeleton, record.atlas, ...record.textures];
    for (const file of expected) {
      const name = baseName(file);
      if (!name || name === '.' || name === '..' || !(Number(availableFiles.get(name)) > 0)) {
        return 'missing-source';
      }
    }
  }

  return '';
}

export function classifyPublishedPreview(record) {
  const blocker = sourceBlocker(record);
  if (blocker) return { status: 'blocked', reason: blocker };

  const selected = typeof record.defaultAnimation === 'string'
    ? record.defaultAnimation
    : '';
  if (!selected) return { status: 'blocked', reason: 'missing-animation-selection' };
  if (!Array.isArray(record.animations) || !record.animations.includes(selected)) {
    return { status: 'failed', reason: 'selected-animation-unavailable' };
  }

  const webmStatus = String(record.webmStatus || '');
  if (record.previewStatus === 'blocked' || webmStatus.startsWith('blocked-')) {
    return { status: 'blocked', reason: webmStatus || 'preview-blocked' };
  }
  if (record.previewStatus !== 'ready' || webmStatus !== 'ready') {
    return { status: 'failed', reason: 'preview-not-ready' };
  }

  const map = record.allAnimationPreviews;
  const hasPerAnimationMap = map && typeof map === 'object' && Object.keys(map).length > 0;
  const selectedPreview = hasPerAnimationMap ? map[selected] : null;
  if (hasPerAnimationMap && !selectedPreview) {
    return { status: 'failed', reason: 'selected-preview-missing' };
  }

  const webmUrl = hasPerAnimationMap ? selectedPreview.webmPreview : record.webmPreview;
  const posterUrl = hasPerAnimationMap
    ? selectedPreview.webpPoster
    : (record.webpPoster || record.thumbnailPoster);

  if (!productionAsset(webmUrl, 'webm') || !productionAsset(posterUrl, 'webp')) {
    return { status: 'failed', reason: 'exact-webm-webp-pair-missing' };
  }
  if (parentPath(webmUrl) !== parentPath(posterUrl)) {
    return { status: 'failed', reason: 'webm-webp-pair-path-mismatch' };
  }

  return { status: 'ready', selectedAnimation: selected, webmUrl, posterUrl };
}

export function validateDecodedVideo(stream, duration) {
  const frames = Number(stream?.nb_read_frames);
  const width = Number(stream?.width);
  const height = Number(stream?.height);
  const seconds = Number(duration);
  return Number.isFinite(frames) && frames >= 8 &&
    Number.isFinite(width) && width > 0 &&
    Number.isFinite(height) && height > 0 &&
    Number.isFinite(seconds) && seconds > 0;
}

export function validateMediaSignature(kind, bytes) {
  if (!bytes || bytes.length < 256) return false;
  if (kind === 'webm') {
    return bytes[0] === 0x1a && bytes[1] === 0x45 &&
      bytes[2] === 0xdf && bytes[3] === 0xa3;
  }
  if (kind === 'webp') {
    return String.fromCharCode(...bytes.subarray(0, 4)) === 'RIFF' &&
      String.fromCharCode(...bytes.subarray(8, 12)) === 'WEBP';
  }
  return false;
}
