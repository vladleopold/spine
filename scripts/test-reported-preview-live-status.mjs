import assert from "node:assert/strict";
import fs from "node:fs";
import {
  classifyOriginHttpStatus,
  classifyPreviewHttpStatus,
  classifyReportedPreviewEntry,
  hasExactPreviewAnimation,
} from "./lib/reported-preview-live-status.mjs";

const exactReady = {
  webmStatus: "ready",
  previewStatus: "ready",
  defaultAnimation: "Idle Post Climax Cum",
  animations: ["Idle Post Climax Cum", "Other"],
  webmAnimation: "Idle Post Climax Cum",
};
assert.equal(hasExactPreviewAnimation(exactReady), true);
assert.equal(classifyReportedPreviewEntry(exactReady), "ready");
assert.equal(classifyReportedPreviewEntry({ ...exactReady, previewStatus: "failed" }), "failed");
assert.equal(classifyReportedPreviewEntry({ ...exactReady, webmStatus: "failed" }), "failed");
assert.equal(classifyReportedPreviewEntry({ ...exactReady, webmStatus: "blocked-missing-source", previewStatus: "blocked" }), "blocked");
assert.equal(classifyReportedPreviewEntry({ ...exactReady, webmStatus: "pending", previewStatus: "pending" }), "blocked");
assert.equal(classifyReportedPreviewEntry({ ...exactReady, webmAnimation: "Other" }), "failed");
assert.equal(classifyReportedPreviewEntry({ ...exactReady, animations: ["Other"] }), "failed");
assert.equal(classifyReportedPreviewEntry({ ...exactReady, webmAnimation: undefined }), "blocked");
assert.equal(classifyReportedPreviewEntry({ ...exactReady, defaultAnimation: "" }), "blocked");
assert.equal(classifyReportedPreviewEntry({ ...exactReady, animations: undefined }), "blocked");
assert.equal(classifyReportedPreviewEntry({ webmStatus: "ready" }), "blocked");

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
assert.doesNotMatch(repairWorkflow, /^  verify-production:/m,
  "the hourly live audit must be the single production verifier, not a duplicate inline job");
const verifyWorkflow = fs.readFileSync(
  new URL("../.github/workflows/verify-reported-preview-live.yml", import.meta.url),
  "utf8",
);
assert.match(verifyWorkflow, /schedule:\s*\n\s+- cron: '\d+ \* \* \* \*'/);
assert.match(verifyWorkflow, /workflow_run:/);
assert.match(verifyWorkflow, /workflow_run\.conclusion == 'success'/);
console.log("REPORTED_PREVIEW_SINGLE_HOURLY_AUDIT_REGRESSION_PASS");
