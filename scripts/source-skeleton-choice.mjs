import path from 'node:path';

function stem(name) {
  return path.basename(String(name||'')).replace(/\.(?:skel|json)$/i,'').toLowerCase();
}

/**
 * Honor the exact skeleton selected for this upload. A byte-identical .skel
 * alias may stand in for a binary file mislabeled .json. A valid converted
 * JSON with the same basename may supersede the original .skel, but another
 * skeleton in the same upload is never selected as a substitute.
 */
export function chooseSourceSkeleton(requested, files, isValidJson) {
  const names=Array.isArray(files)?files:[];
  const wanted=path.basename(String(requested||''));
  if(wanted){
    const wantedStem=stem(wanted);
    const exact=names.find(name=>path.basename(name)===wanted);
    if(exact&&/\.json$/i.test(exact)&&isValidJson(exact))return exact;
    if(/\.skel$/i.test(wanted)){
      const converted=names.find(name=>stem(name)===wantedStem&&/\.json$/i.test(name)&&isValidJson(name));
      if(converted)return converted;
    }
    if(/\.json$/i.test(wanted)){
      const alias=names.find(name=>stem(name)===wantedStem&&/\.skel$/i.test(name));
      if(alias)return alias;
    }
    if(exact&&/\.skel$/i.test(exact))return exact;
    throw new Error('Requested source skeleton is missing or invalid: '+wanted);
  }
  return names.find(name=>/\.json$/i.test(name)&&isValidJson(name))||
    names.find(name=>/\.skel$/i.test(name))||'';
}
