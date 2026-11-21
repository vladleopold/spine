# Legacy root project migration inventory

Audit snapshot: 2026-11-21  
Repository ref: `chore/repository-layout-and-upload-guard`  
Purpose: establish reference dependencies before any legacy project is moved, renamed, or deleted.

## Scope and method

The repository root contains **28 timestamped Spine project directories**. The following GitHub Contents API indexes were inspected:

| Index | Records | Root-project path matches |
|---|---:|---:|
| `index.json` (root) | 1 | 0 |
| `library_01/index.json` | 403 | 0 |
| `library_02/index.json` | 185 | 26 |
| `data-science/index.json` | 496 | 26 |

The 26 matching project IDs occur in both `library_02/index.json` and `data-science/index.json`. Their `previewPath` values still point to the root-level project directory. The data-science records also contain project-identifying references. This is a direct dependency, not merely a similarly named directory.

The two remaining directories, `cb13003_3-2026-10-30T20-34-24-748Z` and `cg10201_01-2026-10-20T18-12-37-496Z`, were not found by exact directory-name matching in those four indexes. Their absence from these indexes does **not** prove they are unused: nested manifests, external URLs, historical proofs, workflow artifacts, or cached/public links may still refer to them.

## Root project inventory

| Root project directory | Index status | Initial structure observation |
|---|---|---|
| `276-spine-2014-2026-10-24T21-47-41-860Z` | Referenced | project folder, source proof, blockchain anchor, preview |
| `321-spine-2025-2026-10-24T21-48-38-912Z` | Referenced | project folder, source proof, blockchain anchor, preview |
| `321-spine-2025-2026-10-24T22-17-53-463Z` | Referenced | project folder, source proof, blockchain anchor, preview |
| `321-spine-2025-2026-10-24T23-08-19-870Z` | Referenced | project folder, source proof, blockchain anchor, preview |
| `321-spine-2025-2026-10-24T23-10-28-743Z` | Referenced | project folder, source proof, blockchain anchor, preview |
| `321-spine-2025-2026-10-25T16-11-53-127Z` | Referenced | project folder, source proof, blockchain anchor, preview |
| `321-spine-2025-2026-10-25T16-16-11-083Z` | Referenced | project folder, source proof, blockchain anchor, preview |
| `321-spine-2025-2026-10-25T16-18-51-649Z` | Referenced | project folder, source proof, blockchain anchor, preview |
| `321-spine-2025-2026-10-25T16-27-47-511Z` | Referenced | project folder, source proof, blockchain anchor, preview |
| `321-spine-2025-2026-10-25T16-42-41-493Z` | Referenced | project folder, source proof, blockchain anchor, preview |
| `321-spine-2025-2026-10-25T16-58-09-052Z` | Referenced | project folder, source proof, blockchain anchor, preview |
| `big_win-2026-10-26T22-02-37-490Z` | Referenced | project folder, source proof, blockchain anchor, preview |
| `build_char_377_gdglow-2026-10-31T01-59-20-411Z` | Referenced | project folder, source proof, blockchain anchor, preview |
| `cb13003_3-2026-10-30T20-34-24-748Z` | No index match found | two nested project directories; no root-level source-proof or anchor file observed |
| `cg10201_01-2026-10-20T18-12-37-496Z` | No index match found | one nested project directory; no root-level source-proof or anchor file observed |
| `character_front-2026-10-12T03-05-59-750Z` | Referenced | project folder, source proof, blockchain anchor, preview |
| `character_right-2026-10-12T02-51-35-323Z` | Referenced | project folder, source proof, blockchain anchor, preview |
| `character1-2026-11-01T23-28-46-401Z` | Referenced | project folder, source proof, blockchain anchor |
| `character2-2026-11-01T23-31-46-459Z` | Referenced | project folder, source proof, blockchain anchor, preview |
| `cherry-2026-10-30T11-24-57-053Z` | Referenced | animation folder, project folder, source proof, anchor, WebP/WebM previews |
| `jp_major-2026-10-12T04-25-44-534Z` | Referenced | project folder, source proof, blockchain anchor, preview |
| `mo_event21_01-2026-10-11T11-18-20-009Z` | Referenced | project folder, source proof, blockchain anchor, preview |
| `symbols-2026-10-11T09-54-25-272Z` | Referenced | project folder, source proof, blockchain anchor |
| `turret_grave-2026-10-28T16-07-13-274Z` | Referenced | project folder, source proof, blockchain anchor, preview |
| `wild_1x1-2026-10-12T11-03-58-484Z` | Referenced | project folder, source proof, blockchain anchor, preview |
| `wild_1x3-2026-10-12T11-36-08-123Z` | Referenced | project folder, source proof, blockchain anchor, preview |
| `wins-2026-10-22T10-56-30-508Z` | Referenced | project folder, source proof, blockchain anchor, preview |
| `yuuka_home-2026-10-30T05-22-48-582Z` | Referenced | project folder, source proof, blockchain anchor, preview |

## Migration decision

- **Do not move or delete any of the 26 referenced directories.** Their current index records depend on the root paths.
- **Do not delete the two unindexed directories.** They need a broader reference and content-integrity audit first.
- The 26 referenced records include source-proof and blockchain-anchor material. These are integrity-sensitive artifacts; Git blob identity alone is not a substitute for validating the proof's embedded hashes and external anchor state.
- The current audit matched exact directory names inside four indexes. It did not yet exhaustively scan every nested file, all source code, workflows, external public URLs, deployment caches, or historical Git commits.
- A migration may proceed only after a complete reference closure, byte-for-byte copy, independent SHA-256 verification of every file, proof/anchor validation, index updates, and live old/new URL checks.

## Next safe migration work

1. Enumerate every file recursively under all 28 directories and record path, byte length, Git blob SHA, and independently computed SHA-256.
2. Parse each `source-proof.json` and `blockchain-anchor.json`; verify every declared file path, size, digest, and external anchor reference.
3. Search all indexes, data-science item records, manifests, source files, workflows, sitemap documents, and Vercel rewrites for each root path and project ID.
4. Produce a proposed path map only. Do not execute moves until every reference and integrity check is accounted for.

This document is an inventory, not authorization to migrate or delete historical project data.
