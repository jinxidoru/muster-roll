#!/usr/bin/env node
// Download the full Wahapedia 40k 10e CSV export into data/wahapedia/ (which is
// gitignored — see .gitignore). Used for local development so we can iterate on
// the CSV->army cross-reference against local files without hammering (or
// depending on) wahapedia.ru. In production the browser pulls the same files
// through a user-configured pass-through instead (CORS blocks a direct fetch).
//
//   node scripts/fetch-wahapedia.js            # download all CSVs
//   node scripts/fetch-wahapedia.js --force    # (same; always overwrites)
//
// Requires Node 18+ (global fetch). This script re-hosts nothing: it only pulls
// the files onto YOUR machine.

import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { WAHAPEDIA_FILES, WAHAPEDIA_BASE } from '../src/wahapedia.js';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = join(ROOT, 'data', 'wahapedia');

async function fetchCsv(name) {
  const res = await fetch(`${WAHAPEDIA_BASE}/${name}.csv`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return Buffer.from(await res.arrayBuffer());
}

async function main() {
  await mkdir(OUT, { recursive: true });
  console.log(`Downloading ${WAHAPEDIA_FILES.length} CSVs from ${WAHAPEDIA_BASE}`);
  console.log(`  -> ${OUT}\n`);
  let ok = 0;
  let bytes = 0;
  for (const name of WAHAPEDIA_FILES) {
    process.stdout.write(`  ${name}.csv … `);
    try {
      const buf = await fetchCsv(name);
      await writeFile(join(OUT, `${name}.csv`), buf);
      bytes += buf.length;
      ok += 1;
      console.log(`${(buf.length / 1024).toFixed(0)} KB`);
    } catch (err) {
      console.log(`FAILED (${err.message})`);
    }
  }
  console.log(`\nDone: ${ok}/${WAHAPEDIA_FILES.length} files, ${(bytes / 1024 / 1024).toFixed(1)} MB total.`);
  if (ok < WAHAPEDIA_FILES.length) process.exitCode = 1;
}

main().catch((err) => { console.error(err); process.exit(1); });
