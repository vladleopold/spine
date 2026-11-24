export function shouldUseGameCamera(bounds = {}, camera = {}, explicit = false) {
  const width = Number(camera.width) > 0 ? Number(camera.width) : 1920;
  const height = Number(camera.height) > 0 ? Number(camera.height) : 1080;
  const sceneWidth = Number(bounds.width) > 0 ? Number(bounds.width) : 0;
  const sceneHeight = Number(bounds.height) > 0 ? Number(bounds.height) : 0;
  return Boolean(explicit) ||
    sceneWidth > width * 1.5 ||
    sceneHeight > height * 1.5;
}
