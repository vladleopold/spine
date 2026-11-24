import assert from "node:assert/strict";
import { chooseAtlasForSkeleton, reconcileDdsAtlasPages, reconcileAtlasPageReferences, stripLegacyPmaMetadata } from "./atlas-pages.mjs";

assert.equal(
  chooseAtlasForSkeleton("Werewolf Cowgirl.skel",
    ["Werewolf Doggy.atlas","Werewolf Cowgirl.atlas"]),
  "Werewolf Cowgirl.atlas");
assert.equal(chooseAtlasForSkeleton("hero.skel",["unrelated.atlas"]),"unrelated.atlas");
assert.equal(chooseAtlasForSkeleton("hero.skel",["wrong.atlas","unrelated.atlas"]),null);
assert.equal(chooseAtlasForSkeleton("character.json",["character.atlas.txt"]),"character.atlas.txt");

const original=[
  "titan.dds","size: 4,4","format: RGBA8888","filter: Linear,Linear","","",
  "not-page.dds","  rotate: false","  xy: 0,0","",
].join("\n");
const fixed=reconcileDdsAtlasPages(original,["unrelated.png","titan.png"]);
assert.equal(fixed.aliases,1);
assert.match(fixed.text,/^titan\.png\nsize:/m);
assert.match(fixed.text,/^not-page\.dds\n  rotate: false/m);
const noMatch=reconcileDdsAtlasPages(original,["unrelated.png"]);
assert.equal(noMatch.aliases,0);
assert.match(noMatch.text,/^titan\.dds\nsize:/m);
console.log("PASS skeleton-specific atlas + exact DDS PNG fallback + no unrelated texture substitution");

const single=reconcileAtlasPageReferences(
  "mismatched.png\nsize: 64,64\nfilter: Linear,Linear\n\nregion\n  rotate: false\n",
  [{name:"real-page.png",width:64,height:64}]);
assert.equal(single.aliases,1);
assert.equal(single.unresolved,0);
assert.match(single.text,/^real-page\.png\nsize: 64,64/m);
assert.match(single.text,/region\n  rotate: false/);
const multipage=reconcileAtlasPageReferences(
  "alpha.png\nsize: 128,64\nformat: RGBA8888\n\nbeta.png\nsize: 64,128\nformat: RGBA8888\n",
  [{name:"actual-first.png",width:128,height:64},{name:"actual-second.png",width:64,height:128}]);
assert.equal(multipage.aliases,2);
assert.equal(multipage.unresolved,0);
assert.match(multipage.text,/^actual-first\.png/m);
assert.match(multipage.text,/^actual-second\.png/m);
const ambiguous=reconcileAtlasPageReferences(
  "missing.png\nsize: 64,64\nformat: RGBA8888\n",
  [{name:"unrelated1.png",width:64,height:64},{name:"unrelated2.png",width:64,height:64}]);
assert.equal(ambiguous.aliases,0);
assert.equal(ambiguous.unresolved,1);
assert.match(ambiguous.text,/^missing\.png/);
console.log("PASS atlas: unambiguous pages by source dimensions; ambiguous cases fail closed");

const legacyPmaAtlas = [
  "", "14505-1.png", "size: 2048,512", "format: RGBA8888",
  "filter: Linear,Linear", "repeat: none", "pma: false", "Ren_10",
  "  rotate: false", "  xy: 200,57", "  size: 26,26",
].join("\n");
const strippedLegacyAtlas = stripLegacyPmaMetadata(legacyPmaAtlas);
assert.equal(strippedLegacyAtlas.removed,1);
assert.doesNotMatch(strippedLegacyAtlas.text,/^\s*pma\s*:/m);
assert.match(strippedLegacyAtlas.text,/^Ren_10$/m);
assert.match(strippedLegacyAtlas.text,/^14505-1\.png$/m);
console.log("PASS legacy Spine 3.8 atlas strips unsupported pma metadata without changing regions");
