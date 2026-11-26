/**
 * MediaRecorder on headless SwiftShader may return only a WebM header and a
 * single frame despite a visible, animated WebGL canvas. Detect that case
 * before posters or quality variants, and switch to deterministic canvas PNG
 * capture rather than marking a real Spine animation as failed.
 */
export function shouldUseCanvasFallback({bytes=0,frames=0,fps=30,duration=0}){
  const size=Number(bytes)||0,count=Number(frames)||0;
  const rate=Math.min(120,Math.max(1,Number(fps)||30));
  const expected=Math.min(900,Math.max(1,Math.ceil(Math.min(30,Math.max(.25,Number(duration)||.25))*rate)));
  // A 2s recording with only 12 encoded frames is too jerky to publish.
  const minimum=Math.max(8,Math.ceil(expected*.60));
  return size<10000 || count<minimum;
}
export function fallbackFrameCount({fps=30,duration=0}){
  const rate=Math.min(120,Math.max(1,Number(fps)||30));
  return Math.max(8,Math.min(900,Math.ceil(Math.min(30,Math.max(.25,Number(duration)||.25))*rate)));
}

/**
 * Deterministic PNG capture calls the browser compositor once per frame.
 * Cap that slower recovery path at 15fps; the regular MediaRecorder path
 * continues to use the requested export FPS.
 */
export function deterministicFallbackFps(fps=30){
  const rate=Math.min(120,Math.max(1,Number(fps)||30));
  return Math.min(rate,15);
}

/**
 * Reuse the last validated live-frame peak when MediaRecorder stops. WebGL
 * readPixels can return an empty buffer after stop despite recent visible motion.
 */
export function shouldRecoverVisibleCanvas({alpha=false,peak=-1,minPeak=40}={}){
  return !alpha && Number.isFinite(Number(peak)) && Number(peak)>=Number(minPeak);
}
