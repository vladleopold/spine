import assert from "node:assert/strict";
import {
  classifyOriginHttpStatus,
  classifyPreviewHttpStatus,
  classifyReportedPreviewEntry,
} from "./lib/reported-preview-live-status.mjs";

assert.equal(classifyReportedPreviewEntry({webmStatus:"blocked-missing-source",previewStatus:"blocked"}), "blocked");
assert.equal(classifyReportedPreviewEntry({webmStatus:"blocked-missing-animation",previewStatus:"blocked"}), "blocked");
assert.equal(classifyReportedPreviewEntry({webmStatus:"blocked-animation-selection-mismatch",previewStatus:"blocked"}), "blocked");
assert.equal(classifyReportedPreviewEntry({webmStatus:"ready",previewStatus:"blocked"}), "blocked");
assert.equal(classifyReportedPreviewEntry({webmStatus:"ready",previewStatus:"failed"}), "failed");
assert.equal(classifyReportedPreviewEntry({webmStatus:"failed",previewStatus:"ready"}), "failed");
assert.equal(classifyReportedPreviewEntry({webmStatus:"pending",previewStatus:"pending"}), "blocked");
assert.equal(classifyReportedPreviewEntry({webmStatus:"ready"}), "ready");
assert.equal(classifyReportedPreviewEntry({webmStatus:"ready",previewStatus:"ready"}), "ready");
assert.equal(classifyReportedPreviewEntry({}), "blocked");

assert.equal(classifyOriginHttpStatus(200), "ok");
assert.equal(classifyOriginHttpStatus(206), "ok");
assert.equal(classifyOriginHttpStatus(402), "blocked");
assert.equal(classifyOriginHttpStatus(503), "blocked");
assert.equal(classifyOriginHttpStatus(0), "blocked");

assert.equal(classifyPreviewHttpStatus(200), "ok");
assert.equal(classifyPreviewHttpStatus(206), "ok");
assert.equal(classifyPreviewHttpStatus(404), "failed");
for (const status of [0, 401, 402, 403, 408, 425, 429, 500, 503]) {
  assert.equal(classifyPreviewHttpStatus(status), "blocked", `HTTP ${status} must block live acceptance`);
}

console.log("REPORTED_PREVIEW_LIVE_STATUS_REGRESSION_PASS");
