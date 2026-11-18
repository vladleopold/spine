import { createHash } from "node:crypto";
import path from "node:path";

// Hash source identity from the authoritative index, never mutable media
// statuses. New uploads may legitimately move this record outside top ten.
export function previewSourceFingerprint(record) {
  return createHash("sha256").update(JSON.stringify({
    id: record?.id || "",
    uploadedAt: record?.uploadedAt || "",
    previewPath: record?.previewPath || "",
    files: Array.isArray(record?.files) ? record.files : [],
  })).digest("hex");
}

// Validate an inventory-time snapshot against the current trusted repository.
// The newest-ten *ranking* may change while long-running render jobs run,
// but this exact work's source identity, shard and preview path must not.
export function validateFrozenRepairRecord(root, item, folders, readIndex) {
  if (!item || typeof item !== "object" ||
      typeof item.id !== "string" ||
      !/^[a-z0-9][a-z0-9._-]{0,200}$/i.test(item.id) ||
      typeof item.basePath !== "string" ||
      !/^library(?:_\d+)?$/.test(item.basePath) ||
      !folders.includes(item.basePath)) {
    throw new Error("Untrusted repair entry");
  }
  const entries = readIndex(root, item.basePath);
  if (!Array.isArray(entries)) throw new Error("Repair index missing");
  const matches = entries.filter(record => record?.id === item.id);
  if (matches.length !== 1) throw new Error("Repair record missing or duplicated");
  const record = matches[0];
  const expectedPath = record.previewPath || item.basePath + "/" + item.id;
  const resolvedPath = path.resolve(root, expectedPath);
  if (typeof item.previewPath !== "string" ||
      expectedPath !== item.previewPath ||
      !item.previewPath.startsWith(item.basePath + "/") ||
      item.previewPath.split("/").includes("..") ||
      !resolvedPath.startsWith(root + path.sep)) {
    throw new Error("Repair path changed or unsafe");
  }
  const timestamp = Date.parse(record.uploadedAt || "");
  if (!Number.isFinite(timestamp) || timestamp !== item.uploadedAt) {
    throw new Error("Repair source timestamp changed");
  }
  if (!/^[a-f0-9]{64}$/.test(item.sourceFingerprint || "") ||
      previewSourceFingerprint(record) !== item.sourceFingerprint) {
    throw new Error("Repair source manifest changed");
  }
  return { id: item.id, basePath: item.basePath,
    previewPath: expectedPath, at: timestamp };
}
