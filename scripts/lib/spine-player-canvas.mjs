export function resolveSpinePlayerCanvas(player, root) {
  const candidates = [
    { canvas: player?.canvas, source: 'player-property' },
    { canvas: root?.querySelector?.('#player canvas'), source: 'player-dom' },
    { canvas: root?.querySelector?.('canvas'), source: 'document-dom' },
  ];
  return candidates.find(({ canvas }) =>
    canvas && typeof canvas.getContext === 'function' &&
    typeof canvas.captureStream === 'function'
  ) || { canvas: null, source: 'missing' };
}
