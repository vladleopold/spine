// Never infer an animation from list order. Preserve an explicit request or the
// exact indexed default verbatim; callers must block when neither exists.
export function chooseRecoveryAnimation(explicitAnimation, indexedDefault = '') {
  if (typeof explicitAnimation === 'string' && explicitAnimation !== '') return explicitAnimation;
  if (typeof indexedDefault === 'string' && indexedDefault !== '') return indexedDefault;
  return '';
}
