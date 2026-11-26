/**
 * Map persisted conversion states to runner exit codes.
 * A missing licensed Editor is persisted as needs-editor, but must fail the
 * workflow so a green GitHub Actions run always means an actual export ran.
 */
export function conversionExitCode(status) {
  if (status === 'ready') return 0;
  if (status === 'needs-editor') return 78; // EX_CONFIG: licensed Editor configuration is missing
  return 1;
}
