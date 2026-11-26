import fs from 'node:fs';
import path from 'node:path';

export function resolveLocalSpinePlayerAssets({
  isLegacy = false,
  versionedRuntimeRoot = '',
  modernRuntime = '',
  repoRoot = '',
  versionMajor = '',
  runtimeMinor = '',
  playerJsUrl = '',
  playerCssUrl = '',
} = {}) {
  if (isLegacy) {
    const version = String(versionMajor) + '.' + String(runtimeMinor);
    return [
      {
        url: playerJsUrl,
        filename: path.join(repoRoot, 'public', 'vendor-spine-player-' + version + '.js'),
        type: 'application/javascript',
        required: true,
      },
      {
        url: playerCssUrl,
        filename: path.join(repoRoot, 'public', 'vendor-spine-player-' + version + '.css'),
        type: 'text/css',
        required: true,
      },
    ];
  }

  if (!versionedRuntimeRoot || !/^4\.\d+$/.test(String(modernRuntime))) return [];
  const playerRoot = path.join(versionedRuntimeRoot, 'spine-' + modernRuntime);
  return [
    {
      url: playerJsUrl,
      filename: path.join(playerRoot, 'node_modules', '@esotericsoftware', 'spine-player', 'dist', 'iife', 'spine-player.js'),
      type: 'application/javascript',
      required: true,
    },
    {
      url: playerCssUrl,
      filename: path.join(playerRoot, 'node_modules', '@esotericsoftware', 'spine-player', 'dist', 'spine-player.css'),
      type: 'text/css',
      required: true,
    },
  ];
}

export function createInlineSpinePlayerAssetUrls(assets, fallback = {}) {
  const find = type => (Array.isArray(assets) ? assets : []).find(asset => asset && asset.type === type);
  const toDataUrl = (asset, type, fallbackUrl) => {
    if (!asset) return fallbackUrl || '';
    if (!fs.existsSync(asset.filename)) {
      if (asset.required) throw new Error('PINNED_SPINE_PLAYER_ASSET_MISSING_' + path.basename(asset.filename));
      return fallbackUrl || '';
    }
    const bytes = fs.readFileSync(asset.filename);
    const mime = type === 'application/javascript' ? 'application/javascript' : 'text/css';
    return 'data:' + mime + ';base64,' + bytes.toString('base64');
  };
  return {
    playerJsUrl: toDataUrl(find('application/javascript'), 'application/javascript', fallback.playerJsUrl),
    playerCssUrl: toDataUrl(find('text/css'), 'text/css', fallback.playerCssUrl),
  };
}
