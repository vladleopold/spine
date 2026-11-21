// Technical pixel visibility check only. Animation selection is immutable;
// never choose a substitute timeline when the selected one is invisible.
export function hasVisibleScreenshotPixels(pixels, threshold=40, minimum=8) {
  if(!pixels||pixels.length<3)return false;
  let bright=0;
  for(let i=0;i+2<pixels.length;i+=3)
    if(Math.max(pixels[i],pixels[i+1],pixels[i+2])>=threshold&&++bright>=minimum)return true;
  return false;
}
