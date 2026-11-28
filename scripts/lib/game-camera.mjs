export function parseGameCamera(value = '') {
  const match = String(value || '').trim().match(/^(\\d+)x(\\d+)$/i);
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
  if (explicit) return true;

  // A tall character can exceed the default landscape camera height without
  // being a game world. Only switch to a fixed camera automatically when the
  // source bounds have a shape reasonably compatible with that camera.
  // Portrait game cameras remain supported through --game-camera=WxH.
  const sceneAspect = sceneWidth > 0 && sceneHeight > 0 ? sceneWidth / sceneHeight : 0;
  const cameraAspect = width / height;
  const aspectRatioDelta = sceneAspect > 0 && cameraAspect > 0
    ? Math.max(sceneAspect / cameraAspect, cameraAspect / sceneAspect)
    : Infinity;
  const cameraShapeCompatible = aspectRatioDelta <= 2;

  return cameraShapeCompatible && (
    sceneWidth > width * 1.5 ||
    sceneHeight > height * 1.5
  );
}
