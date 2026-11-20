#!/usr/bin/env node
// Read-only acceptance of the exact ten-entry inventory produced by the
// repair job. Do not re-read a large Contents API index or re-rank a different set.
import { auditLatestTen } from "./lib/latest-ten-live-audit.mjs";

const items=JSON.parse(process.env.REPAIR_IDS_JSON||"null");
const summary=await auditLatestTen(items);
console.log("PRODUCTION_LAST10_MEDIA_AUDIT="+JSON.stringify(summary));
if(summary.failed||summary.ready+summary.blocked!==10)
  throw new Error("Real production preview acceptance failed");
