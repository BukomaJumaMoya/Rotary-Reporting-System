#!/usr/bin/env node
/**
 * The payload budget, enforced (NFR-1.2).
 *
 * Members pay per megabyte. 250 KB gzipped of initial JavaScript is not a guideline here —
 * a heavy application simply will not be used, and adoption is the project's primary risk.
 * So this is a BUILD FAILURE, not a warning: a warning is a number that drifts upwards for
 * two years while everybody agrees something should be done about it.
 *
 * "Initial" means the entry chunk and everything it imports STATICALLY — what the browser
 * must have before the first screen renders. Lazily imported routes are excluded, which is
 * the whole point of splitting them out; they are reported separately so a chunk that
 * quietly becomes enormous is still visible.
 *
 *   node scripts/bundle-budget.mjs            # check, exit 1 over budget
 *   node scripts/bundle-budget.mjs --json     # the numbers, for a CI summary
 *
 * Run it after `npm run build`.
 */

import { gzipSync } from 'node:zlib';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIST = join(ROOT, 'apps/web/dist');
const MANIFEST = join(DIST, '.vite/manifest.json');

/** NFR-1.2. Gzipped, because that is what crosses the wire. */
const BUDGET_BYTES = 250 * 1024;

/**
 * A single lazy chunk this large means a route nobody split properly. Not a failure — it is
 * a smell, and the person who added it is the one who should decide.
 */
const CHUNK_WARN_BYTES = 60 * 1024;

const asJson = process.argv.includes('--json');

if (!existsSync(MANIFEST)) {
  console.error(
    'No build manifest at apps/web/dist/.vite/manifest.json.\n' +
      'Run `npm run build` first — this check measures the real output, not an estimate.',
  );
  process.exit(1);
}

const manifest = JSON.parse(readFileSync(MANIFEST, 'utf8'));

function gzippedBytes(file) {
  const path = join(DIST, file);
  if (!existsSync(path)) return 0;
  return gzipSync(readFileSync(path), { level: 9 }).length;
}

/**
 * Everything the entry needs before the first paint.
 *
 * `imports` is Vite's list of STATIC imports; `dynamicImports` is deliberately not followed,
 * because those are the routes that were split out. Walked transitively and de-duplicated —
 * a shared chunk imported by two entries is downloaded once and must be counted once.
 */
function initialChunks() {
  const entries = Object.values(manifest).filter((chunk) => chunk.isEntry);
  const seen = new Set();

  const walk = (chunk) => {
    if (!chunk || seen.has(chunk.file)) return;
    seen.add(chunk.file);
    for (const key of chunk.imports ?? []) walk(manifest[key]);
  };

  for (const entry of entries) walk(entry);
  return [...seen].filter((file) => file.endsWith('.js'));
}

const initial = initialChunks();
const initialBytes = initial.reduce((total, file) => total + gzippedBytes(file), 0);

const lazy = Object.values(manifest)
  .map((chunk) => chunk.file)
  .filter((file) => file?.endsWith('.js') && !initial.includes(file))
  .map((file) => ({ file, bytes: gzippedBytes(file) }))
  .sort((a, b) => b.bytes - a.bytes);

const kb = (bytes) => `${(bytes / 1024).toFixed(1)} KB`;

if (asJson) {
  console.log(
    JSON.stringify(
      {
        budgetBytes: BUDGET_BYTES,
        initialBytes,
        initialChunks: initial.map((file) => ({ file, bytes: gzippedBytes(file) })),
        lazyChunks: lazy,
      },
      null,
      2,
    ),
  );
} else {
  console.log('\nbundle-budget — what a member downloads before the first screen\n');
  for (const file of initial) console.log(`  ${kb(gzippedBytes(file)).padStart(9)}  ${file}`);

  const share = Math.round((initialBytes / BUDGET_BYTES) * 100);
  console.log(`\n  initial JS, gzipped:  ${kb(initialBytes)} of ${kb(BUDGET_BYTES)} (${share}%)`);

  if (lazy.length) {
    console.log(`\n  ${lazy.length} lazy chunk(s), downloaded only when the route is opened:`);
    for (const chunk of lazy.slice(0, 8)) {
      console.log(`  ${kb(chunk.bytes).padStart(9)}  ${chunk.file}`);
    }
  }

  // The CSS is not in the budget — NFR-1.2 says JavaScript — but it is on the critical path
  // and a member pays for it, so it is stated rather than quietly excluded.
  const css = Object.values(manifest)
    .flatMap((chunk) => chunk.css ?? [])
    .filter((file, index, all) => all.indexOf(file) === index);
  if (css.length) {
    const cssBytes = css.reduce((total, file) => total + gzippedBytes(file), 0);
    console.log(
      `\n  CSS, gzipped (outside the budget, still on the critical path): ${kb(cssBytes)}`,
    );
  }
}

const oversized = lazy.filter((chunk) => chunk.bytes > CHUNK_WARN_BYTES);
if (oversized.length && !asJson) {
  console.log(
    `\n  note: ${oversized.length} lazy chunk(s) above ${kb(CHUNK_WARN_BYTES)} — worth a look, not a failure.`,
  );
}

if (initialBytes > BUDGET_BYTES) {
  console.error(
    `\nFAIL: initial JS is ${kb(initialBytes)} gzipped, over the ${kb(BUDGET_BYTES)} budget ` +
      `(NFR-1.2) by ${kb(initialBytes - BUDGET_BYTES)}.\n\n` +
      'Members are on metered Android data. Either lazy-load the route that grew — the rule ' +
      'is that a screen a club secretary uses on a phone is eager and everything else is ' +
      'lazy — or make the case for raising the budget in docs/01-SRS.md, which is a district ' +
      'decision rather than a build one.',
  );
  process.exit(1);
}

if (!asJson) console.log('\n  within budget\n');
