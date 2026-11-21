# Spine-Link

Spine-Link is a web application for publishing, previewing, organizing, and preserving Spine animation projects.

## Repository map

| Path | Purpose |
|---|---|
| `src/` | Frontend application source |
| `api/` | Vercel serverless API handlers |
| `lib/` | Shared server/runtime utilities |
| `scripts/` | Build, export, migration, and maintenance tools |
| `tests/` | Automated Node.js tests |
| `test/` | Existing test fixtures and legacy test resources |
| `public/` | Static files served by the frontend |
| `assets/` | Static assets and application media |
| `library/` | Active Spine upload collection and its index |
| `library_NN/` | Numbered, read-only historical library collections |
| `data-science/` | Internal structured animation metadata and taxonomy |
| `diagnostics/` | Operational diagnostics and investigation artifacts |
| `dist/` | Generated Vite build output; never edit by hand |

The repository also contains legacy project directories at its root. They are retained for compatibility while their references, source proofs, and public URLs are being migrated. Do not delete or move them as ordinary cleanup.

## Development

```sh
npm install
npm run dev
npm run build
npm run test:upload-path
```

## Publishing and storage

New projects are written to a project-specific directory inside the active library collection (normally `library/<project-id>/`). Numbered collections such as `library_01/` and `library_02/` are used for sharding. The upload API rejects new project destinations outside this namespace.

Public project URLs and source-origin evidence depend on paths recorded in library indexes, manifests, source-proof documents, and blockchain anchors. Any future storage migration must update these references atomically and preserve compatibility for existing URLs.

See [Repository layout and data lifecycle](docs/architecture/repository-layout.md) before moving or renaming repository paths.
