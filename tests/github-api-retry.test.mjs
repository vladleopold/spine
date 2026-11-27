import test from 'node:test';
import assert from 'node:assert/strict';
import { fetchWithGitHubRetry } from '../scripts/github-api-retry.mjs';

const response = (status) => ({ status, ok: status >= 200 && status < 300 });

test('retries transient GitHub 5xx on idempotent Git database writes', async () => {
  const statuses = [500, 502, 201];
  let calls = 0;
  const result = await fetchWithGitHubRetry(async () => response(statuses[calls++]),
    'https://api.github.com/repos/o/r/git/trees',
    { method: 'POST' }, { delayMs: 0 });
  assert.equal(result.status, 201);
  assert.equal(calls, 3);
});

test('does not retry non-idempotent repository dispatches', async () => {
  let calls = 0;
  const result = await fetchWithGitHubRetry(async () => { calls++; return response(500); },
    'https://api.github.com/repos/o/r/dispatches',
    { method: 'POST' }, { delayMs: 0 });
  assert.equal(result.status, 500);
  assert.equal(calls, 1);
});

test('does not retry permanent client errors', async () => {
  let calls = 0;
  const result = await fetchWithGitHubRetry(async () => { calls++; return response(422); },
    'https://api.github.com/repos/o/r/git/trees',
    { method: 'POST' }, { delayMs: 0 });
  assert.equal(result.status, 422);
  assert.equal(calls, 1);
});

test('bounds retries and returns the final transient response', async () => {
  let calls = 0;
  const result = await fetchWithGitHubRetry(async () => { calls++; return response(503); },
    'https://api.github.com/repos/o/r/git/blobs',
    { method: 'POST' }, { delayMs: 0, maxAttempts: 3 });
  assert.equal(result.status, 503);
  assert.equal(calls, 3);
});


test('retries transient network errors on idempotent Git object writes', async () => {
  let calls = 0;
  const result = await fetchWithGitHubRetry(async () => {
    calls++;
    if (calls < 3) throw new TypeError('temporary network failure');
    return response(201);
  }, 'https://api.github.com/repos/o/r/git/trees', { method: 'POST' }, { delayMs: 0 });
  assert.equal(result.status, 201);
  assert.equal(calls, 3);
});
