/**
 * Match the RGB visibility threshold used by the final preview motion gate.
 * Do not convert to grayscale: low-luminance red/blue artwork can disappear
 * under a grayscale brightness threshold even while RGB pixels are visible.
 */
export function hasVisibleRgbContent(pixels, {
  minPeak = 16,
  minChannelValue = 8,
  minLitPixels = 8,
} = {}) {
  if (!pixels || typeof pixels.length !== "number" || pixels.length === 0 || pixels.length % 3 !== 0) {
    return false;
  }

  let peak = 0;
  let litPixels = 0;
  for (let i = 0; i < pixels.length; i += 3) {
    const intensity = Math.max(pixels[i], pixels[i + 1], pixels[i + 2]);
    if (intensity > peak) peak = intensity;
    if (intensity > minChannelValue) litPixels++;
  }
  return peak >= minPeak && litPixels >= minLitPixels;
}
