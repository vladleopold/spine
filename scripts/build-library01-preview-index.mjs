import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.cwd();
const INPUT = path.join(ROOT, 'library_01', 'index.json');
const OUTPUT = path.join(ROOT, 'library_01', 'preview-index');
const FIELDS = ["id","title","publicOwnerId","ownerAnonId","ownerAnonFingerprint","uploadedAt","ownerName","ownerPicture","note","layout","sourceKind","projectFile","conversionStatus","webmStatus","webmGeneratedAt","skeleton","atlas","textures","animations","defaultAnimation","files","previewPath","repositoryUrl","thumbnail","thumbnailPath","thumbnailPoster","thumbnailPosterPath","thumbnailType","webmPreview","webmPreviewLow","webmPreviewMedium","webmPreviewPath","webpPosterLow","webpPosterMedium","webpPoster","previewWidth","previewHeight","previewDuration","previewAnimation","previewStatus","previewError","hiddenFromPublicLibrary","sourceProofPath","sourceProofUrl","previewBlockedAnimation","previewBlockedSourceFingerprint","previewBlockedRendererRevision","previewBlockedSkin","previewBlockedAt","lastPreviewRetryError","fullExportStatus","fullExportGeneratedAt"];
const ALLOWED = new Set(["webmPreview","webmPreviewMedium","webmPreviewLow","mp4Preview","mp4PreviewMedium","mp4PreviewLow","movAlpha","movAlphaMedium","movAlphaLow","gifAlpha","gifAlphaMedium","gifAlphaLow","pngAlpha","pngAlphaMedium","pngAlphaLow","webpPoster","webpPosterMedium","webpPosterLow","previewDuration","qualityWidths"]);

function compactRootAsset(value) {
  if (typeof value !== 'string' || !value.trim()) return value;
  const raw = value.trim();
  const file = raw.split(/[?#]/)[0].split('/').filter(Boolean).pop() || '';
  const version = raw.match(/[?&]v=([^&#]+)/);
  return file + (version ? '?v=' + version[1] : '');
}

function compactAnimationAsset(value, animation) {
  if (typeof value !== 'string' || !value.trim()) return value;
  const raw = value.trim();
  const file = raw.split(/[?#]/)[0].split('/').filter(Boolean).pop() || '';
  const version = raw.match(/[?&]v=([^&#]+)/);
  return file ? animation + '/' + file + (version ? '?v=' + version[1] : '') : value;
}

export function buildLibrary01PreviewIndex(entries) {
  const shards = new Map();
  for (const source of Array.isArray(entries) ? entries : []) {
    if (!source || typeof source !== 'object' || !source.id) continue;
    const entry = {};
    for (const field of FIELDS) if (source[field] !== undefined) entry[field] = source[field];
    entry.showOwnerLibrary = false;
    const proof = source.sourceProof && typeof source.sourceProof === 'object' ? source.sourceProof : {};
    const anchor = source.blockchainAnchor && typeof source.blockchainAnchor === 'object' ? source.blockchainAnchor : {};
    entry.files = Array.isArray(source.files)
      ? source.files.map((file) => typeof file === 'string' ? file : (file?.path || file?.relativePath || file?.name || '')).filter(Boolean)
      : [];
    entry.sourceProof = {
      ...(proof.proofPath ? { proofPath: proof.proofPath } : {}),
      ...(proof.proofUrl ? { proofUrl: proof.proofUrl } : {}),
      ...(proof.proofHash ? { proofHash: proof.proofHash } : {}),
    };
    entry.blockchainAnchor = {
      ...(anchor.anchorPath ? { anchorPath: anchor.anchorPath } : {}),
      ...(anchor.anchorUrl ? { anchorUrl: anchor.anchorUrl } : {}),
      ...(anchor.anchorHash ? { anchorHash: anchor.anchorHash } : {}),
      ...(anchor.sourceProofHash ? { sourceProofHash: anchor.sourceProofHash } : {}),
    };
    for (const field of ['thumbnail', 'thumbnailPoster', 'webmPreview', 'webmPreviewLow', 'webmPreviewMedium', 'webpPosterLow', 'webpPosterMedium', 'webpPoster']) {
      if (typeof entry[field] === 'string') entry[field] = compactRootAsset(entry[field]);
    }
    const previews = source.allAnimationPreviews && typeof source.allAnimationPreviews === 'object' ? source.allAnimationPreviews : {};
    const chosen = String(source.previewAnimation || source.defaultAnimation || '');
    const selected = chosen && previews[chosen] ? chosen : Object.keys(previews)[0];
    entry.allAnimationPreviews = selected && previews[selected]
      ? { [selected]: Object.fromEntries(Object.entries(previews[selected]).filter(([key]) => ALLOWED.has(key)).map(([key, value]) => [
          key,
          typeof value === 'string' && /^(webmPreview|mp4Preview|movAlpha|gifAlpha|pngAlpha)/.test(key)
            ? compactAnimationAsset(value, selected)
            : typeof value === 'string' && /^webpPoster/.test(key)
              ? compactRootAsset(value)
              : value,
        ])) }
      : {};
    const prefix = String(entry.id).slice(0, 1).toLowerCase() || '_';
    const bucket = shards.get(prefix) || [];
    bucket.push(entry);
    shards.set(prefix, bucket);
  }
  return shards;
}

export function writeLibrary01PreviewIndex(entries, outputDir = OUTPUT) {
  const shards = buildLibrary01PreviewIndex(entries);
  fs.mkdirSync(outputDir, { recursive: true });
  for (const [prefix, items] of shards) fs.writeFileSync(path.join(outputDir, prefix + '.json'), JSON.stringify(items));
  fs.writeFileSync(path.join(outputDir, 'manifest.json'), JSON.stringify({
    version: 1,
    totalEntries: [...shards.values()].reduce((sum, items) => sum + items.length, 0),
    shards: Object.fromEntries([...shards].map(([prefix, items]) => [prefix, items.length])),
  }, null, 2) + '\n');
  return shards.size;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const entries = JSON.parse(fs.readFileSync(INPUT, 'utf8'));
  const count = writeLibrary01PreviewIndex(entries);
  process.stdout.write('Wrote ' + count + ' compact library_01 preview-index shards.\\n');
}
