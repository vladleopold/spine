# Legacy root project migration inventory

Audit snapshot: 2026-11-21  
Repository ref: `chore/repository-layout-and-upload-guard`  
Purpose: record migration dependencies without exposing project identifiers, private asset names, or content hashes.

## Aggregate scope

The audit found 28 timestamped root-level Spine project directories. Four metadata indexes were inspected:

| Index | Records | References to root-level projects |
|---|---:|---:|
| Root index | 1 | 0 |
| `library_01/index.json` | 403 | 0 |
| `library_02/index.json` | 185 | 26 |
| `data-science/index.json` | 496 | 26 |

Twenty-six opaque project records are referenced by both the published library index and the data-science catalog. Their concrete directory names and item identifiers are intentionally omitted from this public document.

Two additional root-level directories were not found by exact-name matching in those indexes. They contain incomplete chunk-upload remnants, including partial image data and some Spine source components. Their absence from the inspected indexes does not prove that they are unused.

## Structural findings

- Ten historical snapshots share some skeleton/atlas Git blobs but have different texture payloads. They are not byte-identical projects and must not be deduplicated by directory name or partial blob equality.
- The two unindexed directories contain incomplete chunk groups. Their original byte lengths, base64 continuity, image signatures, dimensions, atlas references, and skeleton compatibility have not been verified.
- Source-proof and blockchain-anchor artifacts are integrity-sensitive. Git blob identity alone does not validate embedded hashes or external anchor state.

## Migration decision

- Do not move or delete any referenced project directory.
- Do not delete the two unindexed recovery candidates.
- Do not reassemble chunk fragments in place.
- Do not infer that two projects are duplicates from shared JSON/atlas blobs while their textures or proof context differ.
- This audit matched exact references in four indexes only. It did not exhaustively scan every nested manifest, source file, workflow artifact, historical commit, external URL, or deployment cache.

## Required gates before any future migration

1. Enumerate every file recursively and record path, byte length, Git blob SHA, and independently computed SHA-256 in a private audit artifact.
2. Parse source proofs and blockchain anchors; verify each declared path, size, digest, and external reference.
3. Search every index, data-science record, manifest, source file, workflow, sitemap, and deployment rewrite for references to the affected project.
4. Prepare a path map without executing moves.
5. Copy to a temporary destination, verify every byte independently, validate proofs/anchors, update indexes, and test old/new public URLs.
6. Keep private project names, asset identifiers, and content hashes out of public logs, PR descriptions, and committed migration reports.

This document is an aggregate safety summary, not authorization to migrate or delete historical project data.
