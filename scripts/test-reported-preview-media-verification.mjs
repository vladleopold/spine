import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fingerprintPreviewMedia, hasWebmSignature, hasWebpSignature, previewMediaFailureReason, previewRenderDisposition, previewUrlMatches, safePreviewDirectory, selectedPreviewTiers } from "./lib/preview-media-validation.mjs";
import { summarizeRendererLog } from "./renderer-failure-class.mjs";

const animation = "Exact Animation";
const selected = {
  webmPreview: "https://spine-link.vercel.app/assets/library_02/work/preview.webm",
  webmPreviewMedium: "https://spine-link.vercel.app/assets/library_02/work/preview-medium.webm",
  webmPreviewLow: "https://spine-link.vercel.app/assets/library_02/work/preview-low.webm",
  webpPoster: "https://spine-link.vercel.app/assets/library_02/work/preview.webp",
  webpPosterMedium: "https://spine-link.vercel.app/assets/library_02/work/preview-medium.webp",
  webpPosterLow: "https://spine-link.vercel.app/assets/library_02/work/preview-low.webp",
};

test("existing media requires the exact indexed animation and all three WebM/WebP tiers", () => {
  const record = { defaultAnimation: animation, webmStatus: "ready", previewStatus: "ready", webmPreview: selected.webmPreview, webpPoster: selected.webpPoster, allAnimationPreviews: { [animation]: selected } };
  assert.equal(selectedPreviewTiers(record, animation).length, 3);
  assert.equal(selectedPreviewTiers(record, "Other Animation"), null);
  assert.equal(selectedPreviewTiers({ ...record, defaultAnimation: "Other Animation" }, animation), null);
  assert.equal(selectedPreviewTiers({ ...record, allAnimationPreviews: {} }, animation), null);
  assert.equal(selectedPreviewTiers({ ...record, allAnimationPreviews: { [animation]: { webmPreview: selected.webmPreview } } }, animation), null);
});

test("WebM and WebP must have their real container signatures", () => {
  assert.equal(hasWebmSignature(Buffer.from([0x1a, 0x45, 0xdf, 0xa3])), true);
  assert.equal(hasWebmSignature(Buffer.from("not a video")), false);
  assert.equal(hasWebpSignature(Buffer.from("RIFF0000WEBP")), true);
  assert.equal(hasWebpSignature(Buffer.from("RIFF0000PNG!")), false);
});

test("preview paths and direct media URLs must resolve to the same project assets", () => {
  assert.ok(safePreviewDirectory("/tmp/repo", "library_02/work"));
  assert.equal(safePreviewDirectory("/tmp/repo", "../escape"), null);
  assert.equal(safePreviewDirectory("/tmp/repo", "library_02\\work"), null);
  assert.equal(previewUrlMatches(selected.webmPreview, "library_02/work", "preview.webm"), true);
  assert.equal(previewUrlMatches(selected.webmPreview, "library_02/other", "preview.webm"), false);
  assert.equal(previewUrlMatches("data:image/webp;base64,AAAA", "library_02/work", "preview.webp"), false);
});

test("media fingerprint detects any byte change between verification and publish", () => {
  const a = fingerprintPreviewMedia([["preview.webm", Buffer.from("a")], ["preview.webp", Buffer.from("b")]]);
  const b = fingerprintPreviewMedia([["preview.webm", Buffer.from("a")], ["preview.webp", Buffer.from("c")]]);
  assert.notEqual(a, b);
  const reordered = fingerprintPreviewMedia([["preview.webp", Buffer.from("b")], ["preview.webm", Buffer.from("a")]]);
  assert.equal(a, reordered);
});

test("opaque stage-specific failures preserve diagnostic value without leaking child-process details", () => {
  for (const stage of ["MEDIA_READ", "WEBM_PROBE", "WEBP_PROBE", "WEBP_DECODE", "MOTION_VERIFY", "POSTER_FIRST_FRAME"]) {
    const reason = previewMediaFailureReason(stage, "Command failed: /runner/private/path/media.webm");
    assert.equal(reason, stage + "_FAILED");
    assert.doesNotMatch(reason, /runner|private|path/i);
  }
  assert.equal(previewMediaFailureReason("MOTION_VERIFY", "MOTION_ZERO_PIXELS"), "MOTION_ZERO_PIXELS");
  assert.equal(previewMediaFailureReason("MOTION_VERIFY", "MEDIA_DECODE_FAILED"), "MOTION_VERIFY_FAILED");
  assert.equal(previewMediaFailureReason("UNKNOWN", "Command failed: secret"), "MEDIA_CHECK_FAILED");
});

test("the verifier reports the stage and rendition index but never raw paths", () => {
  const verifier = readFileSync(new URL("./verify-existing-preview-media.mjs", import.meta.url), "utf8");
  for (const stage of ["MEDIA_READ", "WEBM_PROBE", "WEBP_PROBE", "WEBP_DECODE", "MOTION_VERIFY", "POSTER_FIRST_FRAME"]) {
    assert.ok(verifier.includes('stage = "' + stage + '"'), "missing stage " + stage);
  }
  assert.match(verifier, /tier=" \+ tierIndex/);
  assert.match(verifier, /previewMediaFailureReason\(stage, error\?\.message\)/);
});

test("repair workflow validates existing bytes before it can classify media as ready", () => {
  const repair = readFileSync(new URL("./repair-reported-previews.mjs", import.meta.url), "utf8");
  const workflow = readFileSync(new URL("../.github/workflows/repair-reported-previews.yml", import.meta.url), "utf8");
  assert.match(repair, /const validationCandidates=matrix\.filter\(x=>x\.ready\)/);
  assert.match(repair, /meta\?\.existingVerified===true/);
  assert.doesNotMatch(repair, /previous media retained/);
  assert.match(workflow, /Validate existing selected animation media before render/);
  assert.match(workflow, /--preview-path="\$PREVIEW_PATH"/);
  assert.match(workflow, /github\.event_name == 'pull_request'/);
  assert.match(workflow, /verify-preview-motion\.mjs/);
  assert.match(workflow, /verify-poster-first-frame\.mjs/);
});

test("pull requests render the exact selected animation privately and verify source preservation", () => {
  const workflow = readFileSync(new URL("../.github/workflows/repair-reported-previews.yml", import.meta.url), "utf8");
  const renderCondition = "if: (github.ref == 'refs/heads/main' || github.event_name == 'pull_request') && matrix.entry.ready && steps.existing.outputs.verified != 'true'";
  assert.equal(workflow.split(renderCondition).length - 1, 3,
    "PRs and main must run the same exact-animation render and source fingerprint gates");
  assert.match(workflow, /EXISTING_MEDIA_INVALID_RENDERING_EXACT_SELECTED_ANIMATION/);
  assert.match(workflow, /Unexpected exact-animation renderer failure; no alternate animation will be used/);
  assert.match(workflow, /Fingerprint source bundle before exact-animation render/);
  assert.match(workflow, /Verify source bundle remained byte-identical/);
  assert.match(workflow, /SOURCE_PRESERVATION_PASS/);
  const artifactStart = workflow.indexOf("      - uses: actions/upload-artifact@v4");
  const publishStart = workflow.indexOf("\n  publish:");
  assert.ok(artifactStart >= 0 && publishStart > artifactStart);
  const artifactStep = workflow.slice(artifactStart, publishStart);
  assert.match(artifactStep, /if: github.ref == 'refs\/heads\/main' && matrix\.entry\.ready/);
  assert.doesNotMatch(artifactStep, /pull_request/);
  assert.match(workflow, /if: always\(\) && github\.ref == 'refs\/heads\/main'/);
  assert.match(workflow, /if: github\.ref == 'refs\/heads\/main' && needs\.publish\.result == 'success'/);
});

test("identical composited frames block the exact animation without selecting a substitute", () => {
  const summary = summarizeRendererLog([
    "Skeleton: redacted (v4.3.17)",
    "SOURCE_SKIN_MODE=default",
    "RECORDER_STATE=recording",
    "No video data captured by MediaRecorder",
    "CANVAS_FALLBACK_CAPTURE=started",
    "Selected animation has no changing canvas frames",
    "frame peak=253",
    "canvas=960x720",
  ].join("\n"));
  assert.equal(summary.reason, "BROWSER_MEDIA_RECORDER");
  assert.equal(summary.distinctError, "COMPOSITED_FRAMES_IDENTICAL");
  assert.equal(summary.stages.canvasFallbackAttempted, true);
  assert.equal(summary.stages.canvasFallbackPassed, false);
  assert.deepEqual(summary.peaks, [253]);
  assert.deepEqual(summary.canvasSizes, [[960, 720]]);
  assert.equal(previewRenderDisposition(summary), "blocked");
  assert.equal(previewRenderDisposition({ distinctError: "NETWORK_ASSET" }), "failed");
  assert.equal(previewRenderDisposition({ distinctError: "MEDIARECORDER_NO_BLOB" }), "failed");
});

test("content-invalid render results publish as blocked, never as ready", () => {
  const repair = readFileSync(new URL("./repair-reported-previews.mjs", import.meta.url), "utf8");
  assert.match(repair, /previewRenderDisposition\(\{distinctError:meta\.failureCode\}\)/);
  assert.match(repair, /record\.webmStatus=noMotion\?"blocked-no-motion":"blocked-render"/);
  assert.match(repair, /record\.previewStatus="blocked"/);
  assert.match(repair, /Selected animation produced identical composited frames/);
  assert.match(repair, /summary\.blocked\+\+/);
});

test("PR render failure policy distinguishes content blocks from infrastructure failures", () => {
  const workflow = readFileSync(new URL("../.github/workflows/repair-reported-previews.yml", import.meta.url), "utf8");
  assert.match(workflow, /previewRenderDisposition\(JSON\.parse\(match\[1\]\)\)/);
  assert.match(workflow, /ACCEPTANCE_BLOCKED_EXACT_SELECTED_ANIMATION/);
  assert.match(workflow, /Unexpected exact-animation renderer failure; no alternate animation will be used/);
  assert.match(workflow, /reason:"blocked",failureCode/);
  const artifactStart = workflow.indexOf("      - uses: actions/upload-artifact@v4");
  const publishStart = workflow.indexOf("\n  publish:");
  const artifactStep = workflow.slice(artifactStart, publishStart);
  assert.match(artifactStep, /if: github.ref == 'refs\/heads\/main' && matrix\.entry\.ready/);
  assert.doesNotMatch(artifactStep, /pull_request/);
});

test("the priority publication is included in the same exact-source repair and live verification batch", () => {
  const repair = readFileSync(new URL("./repair-reported-previews.mjs", import.meta.url), "utf8");
  const live = readFileSync(new URL("./verify-reported-preview-live.mjs", import.meta.url), "utf8");
  const workflow = readFileSync(new URL("../.github/workflows/repair-reported-previews.yml", import.meta.url), "utf8");
  const requested = repair.match(/const requestedIds=\[([\s\S]*?)\n\];/);
  assert.ok(requested, "repair batch must expose its exact requested IDs");
  const ids = [...requested[1].matchAll(/"([^"]+)"/g)].map(match => match[1]);
  const priority = live.match(/const priorityId\s*=\s*"([^"]+)"/);
  assert.ok(priority, "live verifier must keep an explicit priority work");
  assert.equal(ids.length, 19);
  assert.ok(ids.includes(priority[1]), "the priority work must be rendered/validated, not only checked after publish");
  assert.match(live, /const allIds = \[\.\.\.reportedIds, priorityId\]/);
  assert.match(workflow, /selected\.length!==19/);
  assert.match(workflow, /reported19-/);
  assert.match(workflow, /downloaded-reported19/);
  assert.match(workflow, /node scripts\/verify-reported-preview-live\.mjs/);
});
