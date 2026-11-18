#!/usr/bin/env node
// Release-gate diagnostic: emits no source names, archive paths, image pixels
// or raw browser console messages. Only stable error categories and counts.
import fs from "node:fs";

export function classifyRendererError(text) {
  const x=String(text||"").toLowerCase();
  if (/couldn.t load texture atlas page|couldn.t load image|assets could not be loaded|could not load atlas|failed to fetch atlas|texture atlas page/.test(x)) return "ATLAS_TEXTURE_LOAD";
  if (/unknown format|unsupported .*skeleton|unsupported .*spine|unsupported spine/.test(x)) return "SKELETON_RUNTIME_VERSION";
  if (/skeleton.*not found|no spine sets found|missing required files|atlas file missing/.test(x)) return "SOURCE_GRAPH_MISSING";
  if (/animation .*not found|no animation found|invalid animation/.test(x)) return "ANIMATION_SELECTION";
  if (/net::err_|failed to load resource|networkidle|could not resolve host/.test(x)) return "NETWORK_ASSET";
  if (/timed out waiting for player ready|waiting for player ready|waitforfunction.*timeout/.test(x)) return "PLAYER_INITIALIZATION_TIMEOUT";
  if (/no skin produced visible content|frame peak=0|rendered no visible content/.test(x)) return "NO_VISIBLE_PIXEL";
  if (/no video data captured|mediarecorder failed|recorder.*error/.test(x)) return "BROWSER_MEDIA_RECORDER";
  if (/webp generation failed|ffmpeg processing failed|invalid rendered video/.test(x)) return "MEDIA_ENCODING";
  if (/spineplayer is not a function|player creation failed/.test(x)) return "SPINE_RUNTIME_INITIALIZATION";
  if (/syntaxerror|unexpected token|referenceerror|typeerror|cannot read properties/.test(x)) return "SCRIPT_RUNTIME";
  return "OTHER_RENDER_FAILURE";
}

if(process.argv[1] && import.meta.url.endsWith(process.argv[1].split("/").pop()) && process.argv.length>2){
  const log=fs.readFileSync(process.argv[2],"utf8");
  const reason=classifyRendererError(log);
  const version=log.match(/Skeleton:\s*.*?\s+\(v(\d+\.\d+(?:\.\d+)?)\)/i)?.[1]||"unknown";
  const lastCause=[...log.matchAll(/Capture failed:\s*([^\r\n]+)/g)].at(-1)?.[1]||"";
  const secondary=lastCause?classifyRendererError(lastCause):"NONE";
  const attempts=(log.match(/Skin candidates:/g)||[]).length;
  console.log("SANITIZED_RENDER_RESULT="+JSON.stringify({ok:false,reason,secondary,version,attempts}));
}
