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
        required: false,
      },
      {
        url: playerCssUrl,
        filename: path.join(repoRoot, 'public', 'vendor-spine-player-' + version + '.css'),
        type: 'text/css',
        required: false,
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
