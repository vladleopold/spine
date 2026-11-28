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

function extractJsonObject(source, offset) {
  const start = source.indexOf('{', offset);
  if (start < 0) return null;

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = start; index < source.length; index++) {
    const character = source[index];
    if (inString) {
      if (escaped) escaped = false;
      else if (character === '\\') escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') inString = true;
    else if (character === '{') depth++;
    else if (character === '}') {
      depth--;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }
  return null;
}

export function readSpineSkeletonDocument(input) {
  const source = Buffer.isBuffer(input) ? input.toString('utf8') : String(input ?? '');
  const direct = parseSkeletonJson(source);
  if (direct) return { format: 'json', data: direct };

  // Unity may serialize TextAsset.text as an escaped quoted m_Script scalar.
  // JSON.parse decodes that form without evaluating or executing source text.
  const marker = /(?:^|\r?\n)\s*string\s+m_Script\s*[:=]/m.exec(source);
  if (marker) {
    const valueOffset = marker.index + marker[0].length;
    const quoted = source.slice(valueOffset).match(/^\s*("(?:\\.|[^"\\])*")/);
    if (quoted) {
      try {
        const embeddedText = JSON.parse(quoted[1]);
        const embedded = parseSkeletonJson(embeddedText);
        if (embedded) return { format: 'json', data: embedded };
      } catch {}
    }

    // Some Unity exports leave the JSON quotes unescaped inside m_Script.
    // Extract one balanced JSON object, respecting quoted strings and escapes.
    const rawJson = extractJsonObject(source, valueOffset);
    const embedded = rawJson ? parseSkeletonJson(rawJson) : null;
    if (embedded) return { format: 'json', data: embedded };
  }

  return { format: 'binary', data: null };
}
