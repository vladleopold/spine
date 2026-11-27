const RETRYABLE_STATUSES = new Set([429, 500, 502, 503, 504]);
const RETRYABLE_GIT_PATH = /\\/git\\/(?:blobs|trees|commits)(?:\\/|$)/;

function canRetry(url, method) {
  if (method === 'GET') return true;
  return method === 'POST' && RETRYABLE_GIT_PATH.test(new URL(url).pathname);
}

function wait(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Retry only idempotent GitHub reads and Git object creation, never dispatches. */
export async function fetchWithGitHubRetry(fetchImpl, url, init = {}, {
  maxAttempts = 4,
  delayMs = 400,
} = {}) {
  const method = String(init.method || 'GET').toUpperCase();
  const retryable = canRetry(url, method);
  const attempts = Math.max(1, Math.min(6, Number(maxAttempts) || 1));

  for (let attempt = 1; attempt <= attempts; attempt++) {
    let response;
    try {
      response = await fetchImpl(url, init);
    } catch (error) {
      if (!retryable || attempt === attempts) throw error;
      await wait(delayMs * (2 ** (attempt - 1)));
      continue;
    }

    if (!retryable || !RETRYABLE_STATUSES.has(response.status) || attempt === attempts) {
      return response;
    }
    await response.body?.cancel?.();
    const retryAfter = Number(response.headers?.get?.('retry-after'));
    const backoff = Number.isFinite(retryAfter) && retryAfter > 0
      ? Math.min(retryAfter * 1000, 10_000)
      : delayMs * (2 ** (attempt - 1));
    await wait(backoff);
  }
  throw new Error('GitHub request retry loop exhausted unexpectedly');
}
