import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { previewRenderDisposition } from "./lib/preview-media-validation.mjs";

const read=(file)=>fs.readFileSync(path.join(process.cwd(),file),"utf8");
for(const [workflowPath,scriptPath] of [
  [".github/workflows/repair-last-ten-previews.yml","scripts/repair-last-ten-previews.mjs"],
  [".github/workflows/repair-latest-twenty-previews.yml","scripts/repair-latest-twenty-previews.mjs"],
]){
  const workflow=read(workflowPath);
  const script=read(scriptPath);
  assert.ok(workflow.includes("Validate existing selected animation media before render"),workflowPath+" must verify existing bytes before skipping render");
  assert.ok(workflow.includes('--output="out/$REPAIR_SLOT/existing-media.json"'),workflowPath+" must preserve verifier evidence separately from render output");
  assert.ok(workflow.includes("steps.existing.outputs.verified != 'true'"),workflowPath+" must render when existing media verification fails");
  assert.ok(workflow.includes("if: always() && matrix.entry.ready"),workflowPath+" must upload verification artifacts for every source-ready entry");
  assert.ok(script.includes("const required=matrix.filter(x=>x.ready);"),scriptPath+" must inspect every source-ready entry");
  assert.ok(script.includes("existingMediaMatchesVerification"),scriptPath+" must compare the verified byte fingerprint at merge");
  assert.ok(script.includes("existing-media.json"),scriptPath+" must consume the byte-level verifier result");
  assert.ok(script.includes("meta?.animationHash===expectedAnimationHash"),scriptPath+" must bind render output to the exact selected animation");
  assert.ok(!script.includes("if(item.needsRender===false)"),scriptPath+" must not accept metadata-only early exits");
  assert.ok(!script.includes("existingMediaOk(entryInfo"),scriptPath+" must not retain unverified existing media after a render failure");
}
assert.equal(previewRenderDisposition({distinctError:"SELECTED_ANIMATION_HAS_NO_TIMELINES"}),"blocked",
  "an exact selected animation with no keyed timelines is a content blocker, never a substitute-render opportunity");
assert.equal(previewRenderDisposition({distinctError:"COMPOSITED_FRAMES_IDENTICAL"}),"blocked",
  "identical output from the exact selected animation remains blocked");
assert.equal(previewRenderDisposition({distinctError:"FFMPEG_RESOURCE_EXHAUSTED"}),"failed",
  "infrastructure failures must remain failures, not content-blocked successes");

const synthetic=read(".github/workflows/synthetic-webm-render-gate.yml");
assert.ok(synthetic.includes("/scripts/lib/preview-media-validation.mjs"),
  "synthetic render gate sparse checkout must include the verifier dependency");
assert.ok(synthetic.includes("'scripts/lib/preview-media-validation.mjs'"),
  "changes to the verifier dependency must trigger the synthetic render gate");
const reported=read(".github/workflows/repair-reported-previews.yml");
assert.ok(reported.includes("test-repair-existing-media-gates.mjs"),"reported-preview CI must run the cross-workflow regression");

const latestTenWorkflow=read(".github/workflows/repair-last-ten-previews.yml");
const pullRequestStart=latestTenWorkflow.indexOf("  pull_request:\n");
const workflowDispatchStart=latestTenWorkflow.indexOf("  workflow_dispatch:",pullRequestStart);
const pullRequestPaths=pullRequestStart>=0&&workflowDispatchStart>pullRequestStart
  ? latestTenWorkflow.slice(pullRequestStart,workflowDispatchStart) : "";
assert.ok(pullRequestPaths,"latest-ten workflow must run inventory checks on pull requests");
for(const requiredPath of [
  ".github/workflows/repair-last-ten-previews.yml",
  "scripts/repair-last-ten-previews.mjs",
  "scripts/verify-existing-preview-media.mjs",
  "scripts/lib/preview-media-validation.mjs",
  "scripts/test-repair-last-ten-previews.mjs",
  "scripts/test-repair-existing-media-gates.mjs",
]) assert.ok(pullRequestPaths.includes(requiredPath),"latest-ten PR CI must trigger for "+requiredPath);
const renderStart=latestTenWorkflow.indexOf("\n  render:");
const publishStart=latestTenWorkflow.indexOf("\n  publish:",renderStart);
assert.ok(renderStart>=0&&publishStart>renderStart,"latest-ten render job must remain defined");
const renderBlock=latestTenWorkflow.slice(renderStart,publishStart);
const publishBlock=latestTenWorkflow.slice(publishStart);
assert.ok(renderBlock.includes("if: github.ref == 'refs/heads/main'"),
  "PR validation must never render preview assets");
assert.ok(publishBlock.includes("if: always() && github.ref == 'refs/heads/main'"),
  "PR validation must never mutate the public library index");

console.log("REPAIR_EXISTING_MEDIA_GATES_PASS");
