import assert from "node:assert/strict";
import fs from "node:fs";
import {
  classifyOriginHttpStatus,
  classifyPreviewHttpStatus,
  classifyReportedPreviewEntry,
} from "./lib/reported-preview-live-status.mjs";
import { storedPreviewStatusAllowsReuse } from "./lib/reported-preview-repair-status.mjs";

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

const exactReady = { webmStatus: "ready", previewStatus: "ready", defaultAnimation: "Exact" };
assert.equal(storedPreviewStatusAllowsReuse(exactReady, "Exact"), true);
assert.equal(storedPreviewStatusAllowsReuse({ ...exactReady, previewStatus: "failed" }, "Exact"), false,
  "a failed poster/video status must force revalidation even when the work-level WebM flag is ready");
assert.equal(storedPreviewStatusAllowsReuse(
  { ...exactReady, previewStatus: "failed" }, "Exact", { allowFailedStatus: true }), true,
  "a failed status may be restored only after the caller independently verifies the exact stored media");
assert.equal(storedPreviewStatusAllowsReuse(
  { ...exactReady, previewStatus: "failed" }, "Different", { allowFailedStatus: true }), false);
assert.equal(storedPreviewStatusAllowsReuse({ ...exactReady, previewStatus: "blocked" }, "Exact"), false);
assert.equal(storedPreviewStatusAllowsReuse({ ...exactReady, previewStatus: "pending" }, "Exact"), false);
assert.equal(storedPreviewStatusAllowsReuse({ webmStatus: "ready", defaultAnimation: "Exact" }, "Exact"), true,
  "legacy records without previewStatus remain eligible for independent byte/decode checks");
assert.equal(storedPreviewStatusAllowsReuse(exactReady, "Different"), false,
  "stored media may only be reused for the exact indexed animation");
assert.equal(storedPreviewStatusAllowsReuse(exactReady, ""), false);

const repairScript = fs.readFileSync(new URL("./repair-reported-previews.mjs", import.meta.url), "utf8");
assert.ok(repairScript.includes("Spine-animation-2026-11-17T18-45-14-132Z"),
  "the exact priority work must be part of the source repair matrix");
assert.match(repairScript, /storedPreviewStatusAllowsReuse\(record,selected,\{allowFailedStatus\}\)/);
assert.match(repairScript, /inspectAtlasSourceBundle\(p,files\)\.complete/,
  "a complete source bundle must reconcile every atlas page");
assert.match(repairScript, /verify-preview-motion\.mjs/);
assert.match(repairScript, /verify-poster-first-frame\.mjs/);
assert.match(repairScript, /action==="validate-existing"/);
assert.match(repairScript, /existingMediaVerified===true/);
assert.match(repairScript, /existingMediaOk\(entryInfo,selectedAnimation,true\)/);

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
