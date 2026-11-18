import assert from "node:assert/strict";
import { chooseAtlasForSkeleton, reconcileDdsAtlasPages } from "./atlas-pages.mjs";

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
