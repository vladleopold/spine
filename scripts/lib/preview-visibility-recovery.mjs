// Technical pixel visibility check only. Animation and skin selection are immutable.
// Compare against the canvas background, not absolute brightness: dark artwork
// on the dark preview background is still real content, while a blank canvas
// remains uniform and is rejected.
export function hasVisibleScreenshotPixels(pixels, threshold=12, minimum=8) {
  const width=32,height=32,channels=3;
  if(!pixels||pixels.length!==width*height*channels)return false;
  const corners=[0,(width-1)*channels,(height-1)*width*channels,(width*height-1)*channels];
  const background=[0,1,2].map(channel=>{
    const values=corners.map(offset=>pixels[offset+channel]).sort((a,b)=>a-b);
    return (values[1]+values[2])/2;
  });
  let visible=0;
  for(let i=0;i+2<pixels.length;i+=channels){
    const contrast=Math.max(
      Math.abs(pixels[i]-background[0]),
      Math.abs(pixels[i+1]-background[1]),
      Math.abs(pixels[i+2]-background[2])
    );
    if(contrast>=threshold&&++visible>=minimum)return true;
  }
  return false;
}
