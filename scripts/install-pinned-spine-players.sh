#!/usr/bin/env bash
set -euo pipefail
runtime_root="${1:?Expected absolute root for isolated Spine Player runtimes}"
mkdir -p "$runtime_root"
# Match the skeleton's minor version. An unpinned CDN runtime can decode a
# skeleton with the wrong binary layout or fail when GitHub Actions is offline.
for item in 4.0:4.0.31 4.1:4.1.56 4.2:4.2.120 4.3:4.3.13; do
  minor="${item%%:*}"
  version="${item#*:}"
  target="$runtime_root/spine-$minor"
  npm install --prefix "$target" --no-save --no-audit --no-fund "@esotericsoftware/spine-player@$version"
  test -s "$target/node_modules/@esotericsoftware/spine-player/dist/iife/spine-player.js"
  test -s "$target/node_modules/@esotericsoftware/spine-player/dist/spine-player.css"
  echo "PINNED_SPINE_PLAYER_READY minor=$minor version=$version"
done
if [[ -n "${GITHUB_ENV:-}" ]]; then
  printf 'SPINE_VERSIONED_PLAYER_DIR=%s\n' "$runtime_root" >> "$GITHUB_ENV"
fi
