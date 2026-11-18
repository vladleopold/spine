import fs from "node:fs";
import path from "node:path";
import {createHash} from "node:crypto";
import {PNG} from "pngjs";
import {reconstructAtlas} from "../lib/atlas-inference.js";
const id=process.env.SPINE_INFER_ID||"boss_1-2026-11-14T20-07-17-943Z";
if(!/^[a-zA-Z0-9._-]+$/.test(id))throw Error("Invalid entry id");
const root=process.env.SPINE_INFER_LIBRARY||"library_02";
if(!/^library(?:_\d+)?$/.test(root))throw Error("Invalid library id");
const dir=path.join(root,id);
const entries=fs.readdirSync(dir);
const jsons=entries.filter(x=>/\.json$/i.test(x));
const pictures=entries.filter(x=>/\.png$/i.test(x));
if(jsons.length!==1||pictures.length!==1)throw Error("Needs exactly one skeleton JSON and one packed PNG");
const atlasName=jsons[0].replace(/\.json$/i,".atlas");
const atlasPath=path.join(dir,atlasName);
if(fs.existsSync(atlasPath))throw Error("Original atlas already exists; do not overwrite");
const skelBuffer=fs.readFileSync(path.join(dir,jsons[0]));
const pngBuffer=fs.readFileSync(path.join(dir,pictures[0]));
const png=PNG.sync.read(pngBuffer);
const result=reconstructAtlas(JSON.parse(skelBuffer),[{name:pictures[0],width:png.width,height:png.height,rgba:png.data}]);
const ratio=result.matched/result.total;
if(result.confidence<.72||result.coverage<.93||ratio<.70)throw Error("Atlas inference below candidate safety floor");
const names=(result.text.match(/^  rotate: (true|false)$/gm)||[]);
if(names.length!==result.total)throw Error("Region count mismatch");
for(const r of result.regions||[]){
 if(!r.box)continue;
 if(r.box.x<0||r.box.y<0||r.box.w<1||r.box.h<1||
    r.box.x+r.box.w>png.width||r.box.y+r.box.h>png.height)
   throw Error("Atlas region outside texture page");
}
const check=sha=>createHash("sha256").update(sha).digest("hex");
const provenance={
  kind:result.kind,algorithm:"alpha-islands-rectangular-assignment-v1",
  inferenceStatus:"candidate-not-art-approved",
  confidence:result.confidence,foregroundCoverage:result.coverage,
  confidentRegions:result.matched,regionCount:result.total,
  globalScale:result.scale,sourceJsonSha256:check(skelBuffer),sourcePngSha256:check(pngBuffer),
  generatedAt:new Date().toISOString(),nativeSpineEditorValidation:false,
};
fs.writeFileSync(atlasPath,result.text,"utf8");
fs.writeFileSync(path.join(dir,"atlas-inference.json"),JSON.stringify(provenance,null,2)+"\n","utf8");
console.log("ATLAS_INFERENCE_WRITTEN="+JSON.stringify({
 atlasGenerated:fs.existsSync(atlasPath),regionCount:result.total,
 matched:result.matched,scale:result.scale,coverage:result.coverage,
 confidence:result.confidence,sourceUnmodified:true,nativePlaybackConfirmed:false
}));
