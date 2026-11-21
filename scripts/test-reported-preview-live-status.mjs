import assert from "node:assert/strict";
import fs from "node:fs";
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

const repairWorkflow = fs.readFileSync(
  new URL("../.github/workflows/repair-reported-previews.yml", import.meta.url),
  "utf8",
);
const verifyStart = repairWorkflow.indexOf("  verify-production:");
const verifyJob = repairWorkflow.slice(verifyStart);
const checkoutStart = verifyJob.indexOf("sparse-checkout: |");
const checkoutEnd = verifyJob.indexOf("      - uses: actions/setup-node@v4", checkoutStart);
assert.ok(verifyStart >= 0 && checkoutStart >= 0 && checkoutEnd > checkoutStart);
assert.ok(
  verifyJob.slice(checkoutStart, checkoutEnd).includes("/scripts/lib/reported-preview-live-status.mjs"),
  "the production verification job must sparse-checkout its imported status classifier",
);
console.log("REPORTED_PREVIEW_LIVE_AUDIT_CHECKOUT_REGRESSION_PASS");
