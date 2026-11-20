// Builds a numeric animation-index matrix for spine-export-full.
// Animation names stay inside each worker and never cross GitHub job outputs.
import fs from 'node:fs';
import { entryForUpload } from './resolve-library.mjs';
import { buildAnimationIndexMatrix } from './lib/spine-export-matrix.mjs';

const uploadId = process.argv[2];
const outputFile = process.env.GITHUB_OUTPUT;
const found = entryForUpload(process.cwd(), uploadId);
const result = buildAnimationIndexMatrix(found?.entry);

if (outputFile) {
  const lines = [
    `matrix=${JSON.stringify(result.matrix)}`,
    `has_items=${String(result.hasItems)}`,
  ].join('\n') + '\n';
  fs.appendFileSync(outputFile, lines);
}

// Only aggregate counts are printed. Never emit source animation names.
process.stdout.write(JSON.stringify({
  animationCount: result.matrix.length,
  has_items: result.hasItems,
  ...(result.reason ? { reason: result.reason } : {}),
}));
