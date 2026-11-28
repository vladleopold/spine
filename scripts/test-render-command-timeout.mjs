import test from 'node:test';
import assert from 'node:assert/strict';
import {runCommand} from './lib/run-command.mjs';

test('runCommand returns captured output and elapsed time for a successful process', () => {
  const result = runCommand(process.execPath, ['-e', 'process.stdout.write("ready")'], {
    timeoutMs: 1000,
    stdio: 'pipe',
  });

  assert.equal(result.status, 0);
  assert.equal(result.stdout, 'ready');
  assert.ok(result.elapsedMs >= 0);
});

test('runCommand reports a timed-out child with stable diagnostics', () => {
  assert.throws(
    () => runCommand(process.execPath, ['-e', 'setInterval(() => {}, 1000)'], {
      timeoutMs: 80,
      stdio: 'pipe',
    }),
    (error) => {
      assert.equal(error.code, 'COMMAND_TIMEOUT');
      assert.equal(error.timedOut, true);
      assert.equal(error.command, process.execPath);
      assert.ok(error.elapsedMs >= 50);
      return true;
    },
  );
});

test('runCommand preserves a non-zero child exit status', () => {
  const result = runCommand(process.execPath, ['-e', 'process.exit(7)'], {
    timeoutMs: 1000,
    stdio: 'pipe',
  });

  assert.equal(result.status, 7);
});
