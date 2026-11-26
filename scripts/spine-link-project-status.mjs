/** Map persisted conversion states to runner exit codes. Missing license is an actionable queue state, not a failed conversion. */
export function conversionExitCode(status) {
  return status === 'failed' ? 1 : 0;
}
