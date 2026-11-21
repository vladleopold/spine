/**
 * 2.5D turn preparation for layered PSD imports.
 * The caller supplies decoded RGBA layer canvases (e.g. from a PSD decoder).
 * A background is never included in the rotating group.
 */
export type TurnLayer = {
  name: string;
  canvas: HTMLCanvasElement;
  visible?: boolean;
};
export type TurnPrepared = {
  stationary: TurnLayer[];
  rotating: TurnLayer[];
  generatedBack: HTMLCanvasElement;
};
const STATIC_NAMES = /(^|[\s_\-])(back|background|bg|frame|border|orn|ornament|line|light)([\s_\-]|$)/i;
const SUBJECT_NAMES = /(cherry|fruit|berry|stem|leaf|glow)/i;
export function prepareTurnLayers(layers: TurnLayer[]): TurnPrepared {
  if (!layers.length) throw new Error("PSD contains no decoded layers");
  const visible = layers.filter(l => l.visible !== false);
  const rotating = visible.filter(l => SUBJECT_NAMES.test(l.name) && !STATIC_NAMES.test(l.name));
  if (!rotating.length) throw new Error("Cannot identify rotating subject layers; refusing to rotate the background");
  const stationary = visible.filter(l => !rotating.includes(l));
  const width = Math.max(...rotating.map(l => l.canvas.width));
  const height = Math.max(...rotating.map(l => l.canvas.height));
  const back = document.createElement("canvas");
  back.width = width; back.height = height;
  const ctx = back.getContext("2d");
  if (!ctx) throw new Error("Canvas 2D context unavailable");
  ctx.translate(width, 0);
  ctx.scale(-1, 1);
  for (const layer of rotating) ctx.drawImage(layer.canvas, 0, 0);
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.globalCompositeOperation = "multiply";
  ctx.fillStyle = "rgba(115,115,125,0.18)";
  ctx.fillRect(0, 0, width, height);
  ctx.globalCompositeOperation = "destination-in";
  // Preserve the exact generated subject alpha mask.
  const mask = document.createElement("canvas");
  mask.width = width; mask.height = height;
  const m = mask.getContext("2d");
  if (!m) throw new Error("Canvas mask context unavailable");
  m.translate(width, 0); m.scale(-1, 1);
  for (const layer of rotating) m.drawImage(layer.canvas, 0, 0);
  ctx.drawImage(mask, 0, 0);
  ctx.globalCompositeOperation = "source-over";
  return { stationary, rotating, generatedBack: back };
}
/** One revolution around the vertical axis; returns which texture to draw. */
export function sampleTurn360(seconds: number, duration = 2) {
  if (!(duration > 0)) throw new Error("duration must be positive");
  const phase = ((seconds % duration) + duration) % duration / duration;
  const cosine = Math.cos(phase * Math.PI * 2);
  return { scaleX: Math.max(0.001, Math.abs(cosine)), backside: cosine < 0, phase };
}
