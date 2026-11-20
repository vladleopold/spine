import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const installer = fileURLToPath(new URL('./install-pinned-spine-players.sh', import.meta.url));

function writeFakeNpm(binDir) {
  const script = [
    '#!/usr/bin/env bash',
    'set -euo pipefail',
    'printf "%s|" "$*" >> "$FAKE_NPM_LOG"',
    'prefix=""',
    'while (($#)); do',
    '  if [[ "$1" == "--prefix" ]]; then prefix="$2"; shift 2; else shift; fi',
    'done',
    'mkdir -p "$prefix/node_modules/@esotericsoftware/spine-player/dist/iife"',
    'printf "js" > "$prefix/node_modules/@esotericsoftware/spine-player/dist/iife/spine-player.js"',
    'printf "css" > "$prefix/node_modules/@esotericsoftware/spine-player/dist/spine-player.css"',
    ''
  ].join(String.fromCharCode(10));
  const file = path.join(binDir, 'npm');
  fs.writeFileSync(file, script);
  fs.chmodSync(file, 0o755);
}

function runInstaller(root, logPath, envPath, binDir, minor) {
  const args = [installer, root];
  if (minor) args.push(minor);
  return spawnSync('bash', args, {
    encoding: 'utf8',
    env: {
      ...process.env,
      PATH: binDir + path.delimiter + process.env.PATH,
      FAKE_NPM_LOG: logPath,
      GITHUB_ENV: envPath,
    },
  });
}

test('installs one exact minor into the isolated spine-<minor> path', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'spine-player-install-'));
  try {
    const binDir = path.join(temp, 'bin');
    fs.mkdirSync(binDir);
    writeFakeNpm(binDir);
    const root = path.join(temp, 'runtimes');
    const logPath = path.join(temp, 'npm.log');
    const envPath = path.join(temp, 'github-env');
    const result = runInstaller(root, logPath, envPath, binDir, '4.3');
    assert.equal(result.status, 0, result.stderr || result.stdout);
    assert.ok(result.stdout.includes('PINNED_SPINE_PLAYER_READY minor=4.3 version=4.3.13'));
    const args = fs.readFileSync(logPath, 'utf8').split('|').filter(Boolean);
    assert.equal(args.length, 1);
    assert.ok(args[0].includes('@esotericsoftware/spine-player@4.3.13'));
    assert.ok(fs.existsSync(path.join(root, 'spine-4.3', 'node_modules', '@esotericsoftware', 'spine-player', 'dist', 'iife', 'spine-player.js')));
    assert.equal(fs.existsSync(path.join(root, 'spine-4.0')), false);
    assert.ok(fs.readFileSync(envPath, 'utf8').includes('SPINE_VERSIONED_PLAYER_DIR=' + root));
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});

test('without a minor filter the installer preserves all four pinned runtimes', () => {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'spine-player-install-all-'));
  try {
    const binDir = path.join(temp, 'bin');
    fs.mkdirSync(binDir);
    writeFakeNpm(binDir);
    const root = path.join(temp, 'runtimes');
    const logPath = path.join(temp, 'npm.log');
    const envPath = path.join(temp, 'github-env');
    const result = runInstaller(root, logPath, envPath, binDir, '');
    assert.equal(result.status, 0, result.stderr || result.stdout);
    const lines = fs.readFileSync(logPath, 'utf8').split('|').filter(Boolean);
    assert.equal(lines.length, 4);
    for (const version of ['4.0.31', '4.1.56', '4.2.120', '4.3.13']) {
      assert.ok(lines.some(line => line.includes('@esotericsoftware/spine-player@' + version)));
    }
    for (const minor of ['4.0', '4.1', '4.2', '4.3']) {
      assert.ok(fs.existsSync(path.join(root, 'spine-' + minor, 'node_modules', '@esotericsoftware', 'spine-player', 'dist', 'iife', 'spine-player.js')));
    }
  } finally {
    fs.rmSync(temp, { recursive: true, force: true });
  }
});
