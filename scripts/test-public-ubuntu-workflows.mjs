import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const workflowDir = path.resolve('.github', 'workflows');
const files = fs.readdirSync(workflowDir).filter((name) => /\.ya?ml$/i.test(name));
assert.ok(files.length > 0, 'expected GitHub Actions workflow files');

const workflows = files.map((name) => ({
  name,
  source: fs.readFileSync(path.join(workflowDir, name), 'utf8'),
}));
const runners = workflows.flatMap(({ name, source }) => [...source.matchAll(/^\s*runs-on:\s*(.+)$/gm)]
  .map((match) => ({ workflow: name, runner: match[1].trim() })));

assert.ok(runners.length > 0, 'expected at least one GitHub Actions job runner');
const invalidRunners = runners.filter(({ runner }) => runner !== 'ubuntu-24.04');
assert.deepEqual(invalidRunners, [], 'all production workflow jobs must use public GitHub-hosted ubuntu-24.04 runners');

const privateRunnerReferences = workflows.filter(({ source }) => /runs-on:\s*[^\n]*self-hosted/i.test(source));
assert.deepEqual(privateRunnerReferences, [], 'private/self-hosted runners are prohibited');

const outdatedActions = workflows.flatMap(({ name, source }) => {
  const found = [...source.matchAll(/uses:\s*(actions\/(?:checkout|setup-node))@v([1-6])\b/g)]
    .map((match) => ({ workflow: name, action: match[1], version: match[2] }));
  return found;
});
assert.deepEqual(outdatedActions, [], 'checkout and setup-node must use current v7 releases');

process.stdout.write('Audited ' + workflows.length + ' workflows and ' + runners.length + ' jobs: all public ubuntu-24.04; no private runners or outdated checkout/setup-node actions.\n');
