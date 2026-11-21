import path from 'node:path';

function requestedBasename(value) {
  let source=String(value||'').trim().replace(/\\/g,'/');
  if(!source)return '';
  try { source=new URL(source,'https://spine-source.invalid').pathname; } catch {}
  try { source=decodeURIComponent(source); } catch {}
  return path.basename(source);
}

function stem(name) {
  return requestedBasename(name).replace(/\.(?:skel|json)$/i,'').toLowerCase();
}

function ambiguous() {
  throw new Error('Source skeleton is ambiguous; index must name the exact file');
}

/**
 * Honor the exact skeleton selected for this upload. A byte-identical .skel
 * alias may stand in for a binary file mislabeled .json. A valid converted
 * JSON with the same basename may supersede the original .skel, but another
 * skeleton in the same upload is never selected as a substitute.
 *
 * Without indexed metadata, implicit selection is permitted only when the
 * directory contains one unambiguous skeleton identity. A first-file choice
 * would silently render a different rig when an upload contains several.
 */
export function chooseSourceSkeleton(requested, files, isValidJson) {
  const names=Array.isArray(files)?files:[];
  const wanted=requestedBasename(requested);
  if(wanted){
    const exactMatches=names.filter(name=>requestedBasename(name)===wanted);
    if(exactMatches.length>1)ambiguous();
    const exact=exactMatches[0]||'';
    if(exact&&/\.json$/i.test(exact)&&typeof isValidJson==='function'&&isValidJson(exact))return exact;

    const wantedStem=stem(wanted);
    if(/\.skel$/i.test(wanted)){
      const converted=names.filter(name=>stem(name)===wantedStem&&/\.json$/i.test(name)&&
        typeof isValidJson==='function'&&isValidJson(name));
      if(converted.length===1)return converted[0];
      if(converted.length>1)ambiguous();
    }
    if(/\.json$/i.test(wanted)){
      const aliases=names.filter(name=>stem(name)===wantedStem&&/\.skel$/i.test(name));
      if(aliases.length===1)return aliases[0];
      if(aliases.length>1)ambiguous();
    }
    if(exact&&/\.skel$/i.test(exact))return exact;
    throw new Error('Requested source skeleton is missing or invalid: '+wanted);
  }

  const validJson=names.filter(name=>/\.json$/i.test(name)&&
    typeof isValidJson==='function'&&isValidJson(name));
  const binaries=names.filter(name=>/\.skel$/i.test(name));
  const stems=new Set([...validJson,...binaries].map(stem));
  if(stems.size===0)return '';
  if(stems.size!==1)ambiguous();

  const onlyStem=[...stems][0];
  const json=validJson.filter(name=>stem(name)===onlyStem);
  const skel=binaries.filter(name=>stem(name)===onlyStem);
  if(json.length===1)return json[0];
  if(json.length>1)ambiguous();
  if(skel.length===1)return skel[0];
  if(skel.length>1)ambiguous();
  return '';
}
