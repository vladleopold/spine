import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fingerprintPreviewMedia, hasWebmSignature, hasWebpSignature, previewMediaFailureReason, previewUrlMatches, safePreviewDirectory, selectedPreviewTiers } from "./lib/preview-media-validation.mjs";

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
