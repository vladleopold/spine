import {spawnSync} from 'node:child_process';

const DEFAULT_TIMEOUT_MS = 120_000;
const DEFAULT_MAX_BUFFER = 64 * 1024 * 1024;

/**
 * Run a child process synchronously with a hard timeout and structured diagnostics.
 * stdio is forwarded unchanged so callers can choose inherited or captured streams.
 */
export function runCommand(command, args = [], options = {}) {
  const {
    timeoutMs = DEFAULT_TIMEOUT_MS,
    maxBuffer = DEFAULT_MAX_BUFFER,
    killSignal = 'SIGTERM',
    ...spawnOptions
  } = options;

  if (!Number.isSafeInteger(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError('timeoutMs must be a positive safe integer');
  }

  const startedAt = Date.now();
  const result = spawnSync(command, args, {
    encoding: 'utf8',
    maxBuffer,
    ...spawnOptions,
    timeout: timeoutMs,
    killSignal,
  });
  const elapsedMs = Date.now() - startedAt;

  if (result.error) {
    const timedOut = result.error.code === 'ETIMEDOUT';
    const error = new Error(
      timedOut
        ? `Command timed out after ${timeoutMs}ms: ${command}`
        : `Command failed to start: ${command}: ${result.error.message}`,
      {cause: result.error},
    );
    error.code = timedOut ? 'COMMAND_TIMEOUT' : 'COMMAND_SPAWN_FAILED';
    error.command = command;
    error.elapsedMs = elapsedMs;
    error.timeoutMs = timeoutMs;
    error.timedOut = timedOut;
    error.status = result.status;
    error.signal = result.signal;
    error.stdout = String(result.stdout || '');
    error.stderr = String(result.stderr || '');
    throw error;
  }

  return {...result, command, elapsedMs, timeoutMs, timedOut: false};
}
