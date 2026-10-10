// Builds the animation matrix for spine-export-full directly into
// $GITHUB_OUTPUT. The old approach captured `node -e` stdout into a shell
// variable and re-parsed it twice: a stray console.log line broke the first
// parse ("Unexpected token 'C'"), and a silent failure left the variable
// empty ("Unexpected end of JSON input"). Writing the output file ourselves
// removes the shell from the data path entirely.
import fs from 'node:fs';
import { entryForUpload } from './resolve-library.mjs';

const uploadId = process.argv[2];
const outputFile = process.env.GITHUB_OUTPUT;

const found = entryForUpload(process.cwd(), uploadId);
const entry = found ? found.entry : null;

const result = !entry || !Array.isArray(entry.animations) || entry.animations.length === 0
  ? { matrix: [], has_items: false }
  : { matrix: entry.animations, has_items: true };

if (outputFile) {
  const lines = [
    `matrix=${JSON.stringify(result.matrix)}`,
    `has_items=${String(result.has_items)}`,
  ].join('\n') + '\n';
  fs.appendFileSync(outputFile, lines);
}
process.stdout.write(JSON.stringify(result));
