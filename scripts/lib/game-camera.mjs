export function parseGameCamera(value = '') {
  const match = String(value || '').trim().match(/^(\d+)x(\d+)$/i);
  if (!match) return null;
  return {
    width: Math.min(3840, Math.max(320, Number(match[1]))),
    height: Math.min(2160, Math.max(240, Number(match[2]))),
  };
}

export function shouldUseGameCamera(bounds = {}, camera = {}, explicit = false) {
  const width = Number(camera.width) > 0 ? Number(camera.width) : 1920;
  const height = Number(camera.height) > 0 ? Number(camera.height) : 1080;
  const sceneWidth = Number(bounds.width) > 0 ? Number(bounds.width) : 0;
  const sceneHeight = Number(bounds.height) > 0 ? Number(bounds.height) : 0;
  return Boolean(explicit) ||
    sceneWidth > width * 1.5 ||
    sceneHeight > height * 1.5;
}
