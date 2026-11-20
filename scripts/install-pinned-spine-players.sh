#!/usr/bin/env bash
set -euo pipefail
runtime_root="${1:?Expected absolute root for isolated Spine Player runtimes}"
only_minor="${2:-}"
mkdir -p "$runtime_root"
if [[ -n "$only_minor" ]]; then
  case "$only_minor" in
    4.0|4.1|4.2|4.3) ;;
    *) echo "::error::Unsupported pinned Spine Player minor: $only_minor" >&2; exit 2 ;;
  esac
fi
# Match the skeleton's minor version. Keep each package in its own directory
# so the renderer cannot route a different version for the same CDN URL.
installed=0
for item in 4.0:4.0.31 4.1:4.1.56 4.2:4.2.120 4.3:4.3.13; do
  minor="${item%%:*}"
  version="${item#*:}"
  if [[ -n "$only_minor" && "$minor" != "$only_minor" ]]; then
    continue
  fi
  target="$runtime_root/spine-$minor"
  npm install --prefix "$target" --no-save --no-audit --no-fund "@esotericsoftware/spine-player@$version"
  test -s "$target/node_modules/@esotericsoftware/spine-player/dist/iife/spine-player.js"
  test -s "$target/node_modules/@esotericsoftware/spine-player/dist/spine-player.css"
  echo "PINNED_SPINE_PLAYER_READY minor=$minor version=$version"
  installed=$((installed + 1))
done
if [[ -n "$only_minor" && "$installed" -ne 1 ]]; then
  echo "::error::Expected exactly one pinned Spine Player installation for $only_minor" >&2
  exit 1
fi
if [[ -n "${GITHUB_ENV:-}" ]]; then
  printf 'SPINE_VERSIONED_PLAYER_DIR=%s\n' "$runtime_root" >> "$GITHUB_ENV"
fi
