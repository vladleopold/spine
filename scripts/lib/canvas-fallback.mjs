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
 * The deterministic CDP screenshot path is much slower than MediaRecorder.
 * Cap only this recovery path at 15fps; normal exports keep their requested FPS.
 */
export function deterministicFallbackFps(fps=30){
  const rate=Math.min(120,Math.max(1,Number(fps)||30));
  return Math.min(rate,15);
}

/**
 * Recover the already validated live Spine canvas if MediaRecorder produced
 * no playable blob. The same-animation visibility and motion gates still run.
 */
export function shouldRecoverVisibleCanvas({alpha=false,peak=-1,minPeak=40}={}){
  return !alpha && Number.isFinite(Number(peak)) && Number(peak)>=Number(minPeak);
}
