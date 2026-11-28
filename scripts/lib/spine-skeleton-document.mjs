// Read Spine JSON skeleton data even when Unity stores it inside a .skel
// TextAsset wrapper. Source files are never rewritten; callers decide how to
// serve the extracted document to the runtime.
function parseSkeletonJson(value) {
  try {
    const data = JSON.parse(value);
    if (data && typeof data === 'object' && Array.isArray(data.bones)) return data;
  } catch {}
  return null;
}

export function readSpineSkeletonDocument(input) {
  const source = Buffer.isBuffer(input) ? input.toString('utf8') : String(input ?? '');
  const direct = parseSkeletonJson(source);
  if (direct) return { format: 'json', data: direct };

  // Unity text serialization stores TextAsset.text in a quoted m_Script scalar.
  // JSON.parse handles escaped quotes, slashes and control characters without
  // evaluating source text or executing any embedded content.
  const match = source.match(/(?:^|\r?\n)\s*string\s+m_Script\s*[:=]\s*("(?:\\.|[^"\\])*")/m);
  if (match) {
    try {
      const embeddedText = JSON.parse(match[1]);
      const embedded = parseSkeletonJson(embeddedText);
      if (embedded) return { format: 'json', data: embedded };
    } catch {}
  }

  return { format: 'binary', data: null };
}
