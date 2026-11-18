import fs from "node:fs";
import path from "node:path";
import {PNG} from "pngjs";
import {reconstructAtlas} from "../lib/atlas-inference.js";
const folder="library_02/boss_1-2026-11-14T20-07-17-943Z";
const skeleton=JSON.parse(fs.readFileSync(path.join(folder,"boss_1.json"),"utf8"));
const picture=PNG.sync.read(fs.readFileSync(path.join(folder,"boss_1.png")));
const result=reconstructAtlas(skeleton,[{name:"boss_1.png",width:picture.width,height:picture.height,rgba:picture.data}]);
const matches=(result.regions||[]);
const confident=matches.filter(x=>x.score>=.7);
const rotated=confident.filter(x=>x.rotated);
const count=matches.length;
const scores=matches.map(x=>x.score).sort((a,b)=>a-b);
console.log(JSON.stringify({imageDimensions:[picture.width,picture.height],
  matchCount:result.matched,total:count,scale:result.scale,
  rotationCount:rotated.length,coverage:result.coverage,confidence:result.confidence,
  lowConfident:matches.filter(x=>x.score<.7).length,
  scorePercentiles:[scores[0],scores[Math.floor(count*.25)],scores[Math.floor(count*.5)],scores[Math.floor(count*.75)],scores[count-1]],
  atlasParserRegionCount:(result.text.match(/  rotate: (true|false)/g)||[]).length,
  atlasPageNameCorrect:result.text.startsWith("boss_1.png\n"),
  privateSourcePreserved:true,
  note:"Only numerical geometry / confidence; no NDA images, atlas coordinates or filenames output"
},null,2));
if(!result.text.startsWith("boss_1.png\n")||count<15||
  !result.text.includes("size: 790,310"))throw Error("Reconstructed atlas invalid");
