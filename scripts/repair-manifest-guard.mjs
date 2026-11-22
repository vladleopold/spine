import fs from "node:fs";
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


 // Bind verified media to every byte and relative filename in the source directory.
 // A concurrent main update must invalidate an artifact generated from older files.
 export function previewSourceBytesFingerprint(root, previewPath) {
   const relative = String(previewPath || "");
   if (!relative || relative.startsWith("/") || relative.includes(String.fromCharCode(92)) ||
       relative.split("/").some((part) => !part || part === "." || part === "..")) {
     throw new Error("Unsafe preview source path");
   }
   const rootPath = path.resolve(root);
   const directory = path.resolve(rootPath, relative);
   if (!directory.startsWith(rootPath + path.sep)) throw new Error("Unsafe preview source path");
   const hash = createHash("sha256");
   hash.update(relative).update("\\0");
   let fileCount = 0;
   const visit = (current, prefix = "") => {
     const entries = fs.readdirSync(current, { withFileTypes: true }).sort((a, b) =>
       a.name < b.name ? -1 : a.name > b.name ? 1 : 0);
     for (const entry of entries) {
       const relativeName = prefix ? prefix + "/" + entry.name : entry.name;
       const fullPath = path.join(current, entry.name);
       if (entry.isSymbolicLink()) throw new Error("Symlink in preview source bundle");
       if (entry.isDirectory()) visit(fullPath, relativeName);
       else if (entry.isFile()) {
         const bytes = fs.readFileSync(fullPath);
         hash.update(relativeName).update("\\0").update(String(bytes.length)).update("\\0")
           .update(bytes).update("\\0");
         fileCount++;
       }
     }
   };
   visit(directory);
   if (fileCount === 0) throw new Error("Preview source bundle is empty");
   return hash.digest("hex");
 }

// Older archive IDs embed their upload timestamp even when uploadedAt is blank.
export function repairRecordTimestamp(record) {
  const uploadedAt = Date.parse(record?.uploadedAt || "");
  if (Number.isFinite(uploadedAt)) return uploadedAt;
  const match = String(record?.id || "").match(/-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/);
  if (!match) return NaN;
  return Date.parse(`${match[1]}T${match[2]}:${match[3]}:${match[4]}.${match[5]}Z`);
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
  if (record.hiddenFromPublicLibrary === true || record.testOnly === true) {
    throw new Error("Repair record is not public");
  }
  const rawExpectedPath = record.previewPath || item.id;
  const hasShardPrefix = /^library(?:_\d+)?\//.test(rawExpectedPath);
  if (hasShardPrefix && !rawExpectedPath.startsWith(item.basePath + "/")) {
    throw new Error("Repair path shard changed or unsafe");
  }
  const expectedPath = rawExpectedPath.startsWith(item.basePath + "/")
    ? rawExpectedPath
    : path.posix.join(item.basePath, rawExpectedPath);
  const resolvedPath = path.resolve(root, expectedPath);
  if (typeof item.previewPath !== "string" ||
      expectedPath !== item.previewPath ||
      !item.previewPath.startsWith(item.basePath + "/") ||
      item.previewPath.split("/").includes("..") ||
      !resolvedPath.startsWith(root + path.sep)) {
    throw new Error("Repair path changed or unsafe");
  }
  const timestamp = repairRecordTimestamp(record);
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
