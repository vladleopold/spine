import fs from 'node:fs';

const blockedCodes = new Set([
  'SELECTED_SPINE_ANIMATION_NOT_SPECIFIED',
  'SELECTED_SPINE_ANIMATION_UNAVAILABLE',
  'SPINE_LEGACY_RUNTIME_UNAVAILABLE',
]);
const stages = new Set(['selection', 'initial-render', 'render', 'verification', 'publish', 'complete']);

export function classifyRenderFailure(error) {
  const message = String(error?.message || error || '');
  if (message.includes('SELECTED_SPINE_ANIMATION_NOT_SPECIFIED')) return 'SELECTED_SPINE_ANIMATION_NOT_SPECIFIED';
  if (message.includes('SELECTED_SPINE_ANIMATION_UNAVAILABLE')) return 'SELECTED_SPINE_ANIMATION_UNAVAILABLE';
  if (message.includes('SPINE_LEGACY_RUNTIME_UNAVAILABLE')) return 'SPINE_LEGACY_RUNTIME_UNAVAILABLE';
  return 'RENDER_FAILED';
}

export function createRenderFailureReceipt(stage, error, formats = []) {
  const code = classifyRenderFailure(error);
  const safeFormats = Array.isArray(formats) ? formats.map((format) => ({
    type: /^[a-z0-9.+-]{1,16}$/i.test(String(format?.type || '')) ? String(format.type) : 'media',
    codec: /^[a-z0-9._-]{1,24}$/i.test(String(format?.codec || '')) ? String(format.codec) : '',
    width: Number.isFinite(Number(format?.width)) ? Math.max(0, Number(format.width)) : 0,
    height: Number.isFinite(Number(format?.height)) ? Math.max(0, Number(format.height)) : 0,
    frames: Number.isFinite(Number(format?.frames)) ? Math.max(0, Number(format.frames)) : 0,
    duration: Number.isFinite(Number(format?.duration)) ? Math.max(0, Number(format.duration)) : 0,
  })) : [];
  const safeStage = stages.has(stage) ? stage : 'render';
  return { status: blockedCodes.has(code) ? 'blocked' : 'failed', stage: safeStage, code, formats: safeFormats };
}

export function writeRenderFailureReceipt(filePath, stage, error, formats = []) {
  const receipt = createRenderFailureReceipt(stage, error, formats);
  fs.writeFileSync(filePath, JSON.stringify(receipt, null, 2));
  return receipt;
}
