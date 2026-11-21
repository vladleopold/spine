import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import {
  storedPreviewStatusAllowsReuse,
  resolveStoredPreviewMediaFiles,
} from "./lib/reported-preview-repair-status.mjs";
import { inspectAtlasSourceBundle } from "./lib/atlas-source-integrity.mjs";

const base="https://spine-link.vercel.app/assets/legacy-work/animations/selected/";
const prefix="legacy-work-anim-selected-";
const media={
  webmPreview:base+prefix+"preview.webm",
  webmPreviewMedium:base+prefix+"preview-medium.webm",
  webmPreviewLow:base+prefix+"preview-low.webm",
  webpPoster:base+prefix+"preview.webp",
  webpPosterMedium:base+prefix+"preview-medium.webp",
  webpPosterLow:base+prefix+"preview-low.webp",
};
const record={defaultAnimation:"selected",webmStatus:"ready",allAnimationPreviews:{selected:media}};
const entry={id:"legacy-work",previewPath:"legacy-work"};

assert.equal(storedPreviewStatusAllowsReuse(record,"selected"),false,
  "missing previewStatus must be revalidated instead of silently remaining hidden");
assert.equal(storedPreviewStatusAllowsReuse({...record,previewStatus:"failed"},"selected"),false);
assert.equal(storedPreviewStatusAllowsReuse({...record,previewStatus:"ready"},"selected"),true);
assert.equal(storedPreviewStatusAllowsReuse(record,"selected",{allowFailedStatus:true}),true,
  "an explicit verification pass may inspect stale status, but not choose another animation");
assert.equal(storedPreviewStatusAllowsReuse({...record,webmStatus:"failed"},"selected",{allowFailedStatus:true}),false);
assert.equal(storedPreviewStatusAllowsReuse(record,"other",{allowFailedStatus:true}),false);

const resolved=resolveStoredPreviewMediaFiles(entry,record,"selected");
assert.ok(resolved);
assert.equal(resolved.directory,"legacy-work/animations/selected");
assert.deepEqual(Object.keys(resolved.files).sort(),Object.keys(media).sort());
assert.equal(resolved.files.webmPreview,
  "legacy-work/animations/selected/legacy-work-anim-selected-preview.webm");
assert.equal(resolved.files.webpPosterMedium,
  "legacy-work/animations/selected/legacy-work-anim-selected-preview-medium.webp");
assert.equal(resolveStoredPreviewMediaFiles(entry,record,"missing"),null,
  "the resolver must not borrow a different animation's media map");
assert.equal(resolveStoredPreviewMediaFiles(entry,{...record,allAnimationPreviews:{other:media}},"selected"),null);
assert.equal(resolveStoredPreviewMediaFiles(entry,{...record,allAnimationPreviews:{selected:{...media,webpPosterMedium:base+"other-preview-medium.webp"}}},"selected"),null,
  "poster and video stems must match exactly");
assert.equal(resolveStoredPreviewMediaFiles(entry,{...record,allAnimationPreviews:{selected:{...media,webmPreviewLow:media.webmPreviewLow.replace("legacy-work/","other-work/")}}},"selected"),null,
  "all media must remain under the same work directory");
assert.equal(resolveStoredPreviewMediaFiles(entry,{...record,allAnimationPreviews:{selected:{...media,webmPreview:media.webmPreview.replace("https://spine-link.vercel.app","https://evil.example")}}},"selected"),null);
assert.equal(resolveStoredPreviewMediaFiles(entry,{...record,allAnimationPreviews:{selected:{...media,webmPreview:base+"../outside-preview.webm"}}},"selected"),null);

// A nested source set must be inspectable without flattening or rewriting files.
const root=fs.mkdtempSync(path.join(os.tmpdir(),"nested-spine-source-"));
try {
  const source=path.join(root,"nested");
  fs.mkdirSync(source,{recursive:true});
  fs.writeFileSync(path.join(source,"hero.json"),JSON.stringify({
    skeleton:{spine:"4.2.00",width:10,height:10},bones:[{name:"root"}],animations:{selected:{bones:{root:{rotate:[{time:0,angle:0},{time:1,angle:1}]}}}},
  }));
  const png=Buffer.alloc(24);
  Buffer.from([137,80,78,71,13,10,26,10]).copy(png,0);
  png.writeUInt32BE(2,16);png.writeUInt32BE(2,20);
  fs.writeFileSync(path.join(source,"hero.png"),png);
  fs.writeFileSync(path.join(source,"hero.atlas"),"hero.png\nsize: 2,2\nformat: RGBA8888\n\n");
  const result=inspectAtlasSourceBundle(root,["nested/hero.json","nested/hero.atlas","nested/hero.png"]);
  assert.equal(result.complete,true,"nested JSON + atlas + texture must be checked as the original source set");
  assert.equal(fs.existsSync(path.join(source,"hero.json")),true);
} finally { fs.rmSync(root,{recursive:true,force:true}); }

const repairSource=fs.readFileSync(new URL("./repair-reported-previews.mjs",import.meta.url),"utf8");
assert.match(repairSource,/additionalIdHashes/);
assert.match(repairSource,/record\?\.files/);
assert.match(repairSource,/resolveStoredPreviewMediaFiles/);
console.log("PASS stale preview status, exact legacy media map, nested source integrity and source-preserving repair contracts");
