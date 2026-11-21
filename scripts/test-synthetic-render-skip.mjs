import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const prepare = fileURLToPath(new URL('./prepare-render.mjs', import.meta.url));
const root = fs.mkdtempSync(path.join(os.tmpdir(), 'spine-testonly-render-'));
try {
  const lib = path.join(root, 'library');
  const bin = path.join(root, 'bin');
  fs.mkdirSync(lib, { recursive: true });
  fs.mkdirSync(bin);
  const gitLog = path.join(root, 'git.log');
  const eventPath = path.join(root, 'event.json');
  const outputPath = path.join(root, 'outputs.txt');
  const fakeGit = path.join(bin, 'git');
  fs.writeFileSync(fakeGit, '#!/bin/sh\nprintf "%s\\n" "$*" >> "$SPINE_TEST_GIT_LOG"\n');
  fs.chmodSync(fakeGit, 0o755);

  function verify({ testOnly, hidden = true, expectedSkip,
    id = 'spine-link-e2e-2026-11-18T00-00-00Z', previewPath = 'library/synthetic' }) {
    fs.writeFileSync(path.join(lib, 'index.json'),
      JSON.stringify([{ id, testOnly, hiddenFromPublicLibrary: hidden, previewPath }]));
    fs.writeFileSync(eventPath, JSON.stringify({
      client_payload: { uploadId: id },
    }));
    fs.writeFileSync(outputPath, '');
    fs.writeFileSync(gitLog, '');
    const run = spawnSync(process.execPath, [prepare], {
      cwd: root,
      encoding: 'utf8',
      env: {
        ...process.env,
        GITHUB_EVENT_NAME: 'repository_dispatch',
        GITHUB_EVENT_PATH: eventPath,
        GITHUB_OUTPUT: outputPath,
        SPINE_TEST_GIT_LOG: gitLog,
        PATH: bin + path.delimiter + process.env.PATH,
      },
    });
    assert.equal(run.status, 0, run.stderr);
    const output = fs.readFileSync(outputPath, 'utf8');
    assert.match(output, new RegExp('skip_render=' + expectedSkip + '\\n'));
    const git = fs.readFileSync(gitLog, 'utf8');
    assert.equal(Boolean(git.trim()), !expectedSkip,
      'only real uploads may fetch the sparse render assets');
    if (expectedSkip) {
      assert.match(run.stdout, /SKIP_TEST_ONLY_WEBM_RENDER/);
    }
  }

  verify({ testOnly: true, expectedSkip: true });
  verify({ testOnly: true, hidden: false, expectedSkip: false });
  verify({ testOnly: true, id: 'normal-work', expectedSkip: false });
  verify({ testOnly: false, expectedSkip: false });
  verify({ testOnly: 'true', expectedSkip: false });
  verify({ testOnly: undefined, expectedSkip: false });
  console.log('PASS: synthetic upload skips WebM; genuine uploads retain render path');
} finally {
  fs.rmSync(root, { recursive: true, force: true });
}
