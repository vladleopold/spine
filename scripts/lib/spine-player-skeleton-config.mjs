// Map a skeleton source to the URL property understood by its matching Spine Web Player.
// Spine 3.8 uses skelUrl; Spine 4.x renamed the binary source option to binaryUrl.
export function spineSkeletonUrlConfig(fileName, version, url) {
  const extension = String(fileName || '').split('.').pop()?.toLowerCase();
  if (extension === 'json') return { jsonUrl: url };

  if (extension !== 'skel') return {};
  const match = String(version || '').trim().match(/^(\d+)\.(\d+)(?:[.-]|$)/);
  if (!match) return {};

  const major = Number(match[1]);
  const minor = Number(match[2]);
  if (major === 3 && minor === 8) return { skelUrl: url };
  if (major === 4 && minor >= 0 && minor <= 3) return { binaryUrl: url };
  // Spine 3.7's Web Player accepts JSON only; other majors need a matching
  // runtime or a source re-export and must not be guessed as binaryUrl.
  return {};
}
