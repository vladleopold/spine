export function previewRepairCommitMessage(summary) {
  const counts = ['ready', 'blocked', 'failed'].map((key) => {
    const value = Number(summary?.[key]);
    if (!Number.isInteger(value) || value < 0) {
      throw new Error(`INVALID_PREVIEW_REPAIR_SUMMARY_${key.toUpperCase()}`);
    }
    return value;
  });
  const [ready, blocked, failed] = counts;
  if (ready + blocked + failed === 0) {
    throw new Error('EMPTY_PREVIEW_REPAIR_SUMMARY');
  }
  const detail = `(${ready} ready, ${blocked} blocked, ${failed} failed)`;
  if (ready > 0) return `fix: publish latest-20 verified preview results ${detail}`;
  if (blocked > 0) return `chore: record latest-20 blocked preview results ${detail}`;
  return `chore: record latest-20 failed preview results ${detail}`;
}
