export function setPlayerAnimation(player, name) {
  if (!player || typeof player.setAnimation !== 'function') {
    throw new Error('SpinePlayer.setAnimation is required to update the animation viewport');
  }
  if (player.animationState && typeof player.animationState.clearTracks === 'function') {
    player.animationState.clearTracks();
  }
  const entry = player.setAnimation(name, true);
  player.paused = false;
  return entry;
}
