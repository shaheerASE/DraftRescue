/**
 * Enforces the content script's size budget.
 *
 * The content script is injected into every page the user visits, so its cost
 * is other people's page-load budget, not ours. The spec sets 20 KB gzipped.
 * This runs after a build and fails loudly if we drift past it.
 *
 *   npm run build && node scripts/check-size.mjs
 */
import { gzipSync } from 'node:zlib';
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const BUDGET_BYTES = 20 * 1024;
const DIR = resolve(
  dirname(fileURLToPath(import.meta.url)),
  '../.output/chrome-mv3/content-scripts',
);

let files;
try {
  files = readdirSync(DIR).filter((f) => f.endsWith('.js'));
} catch {
  console.error(`No build output at ${DIR}. Run \`npm run build\` first.`);
  process.exit(1);
}

let total = 0;
for (const file of files) {
  const gz = gzipSync(readFileSync(join(DIR, file))).length;
  total += gz;
  console.log(`  ${file}  ${(gz / 1024).toFixed(2)} KB gzipped`);
}

const pct = ((total / BUDGET_BYTES) * 100).toFixed(0);
console.log(
  `\ncontent script total: ${(total / 1024).toFixed(2)} KB gzipped ` +
    `/ ${BUDGET_BYTES / 1024} KB budget (${pct}%)`,
);

if (total > BUDGET_BYTES) {
  console.error('\nOVER BUDGET. Do not ship this.');
  process.exit(1);
}
