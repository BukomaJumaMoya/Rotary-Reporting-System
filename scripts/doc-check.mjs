#!/usr/bin/env node
/**
 * doc-check — verifies that the documentation still describes the system.
 *
 * `docs/` is authoritative in this project (CLAUDE.md says so), which only works if the
 * documents are true. They go stale silently: nothing breaks when the API spec omits an
 * endpoint, so nobody notices until a session is planned from a document that describes a
 * system that no longer exists.
 *
 * Every check here compares a document against the CODE, and each one states what it
 * proves. A check that cannot run reports SKIP rather than passing — the project has
 * already been bitten once by a harness that passed vacuously (the no-PII route walker,
 * M0 session 5), and a green tick that means nothing is worse than no tick.
 *
 *   npm run docs:check              everything that needs no database, warnings allowed
 *   npm run docs:check -- --strict  warnings become failures. The milestone gate.
 *   npm run docs:check -- --with-db adds the schema.sql rebuild-and-diff
 *
 * Run by `/close-milestone`. Wire it into CI only once it is quiet on a good tree.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const STRICT = argv.includes('--strict');
const WITH_DB = argv.includes('--with-db');

const results = [];
const ok = (name, detail) => results.push({ status: 'ok', name, detail });
const fail = (name, detail, items = []) => results.push({ status: 'fail', name, detail, items });
const warn = (name, detail, items = []) => results.push({ status: 'warn', name, detail, items });
const skip = (name, detail) => results.push({ status: 'skip', name, detail });

// Normalised to LF: this is a Windows checkout, and a `\n\n` in a pattern will not match
// `\r\n\r\n` on disk. Every regex below would silently find nothing.
const read = (rel) => readFileSync(join(ROOT, rel), 'utf8').replace(/\r\n/g, '\n');
const readIf = (rel) => (existsSync(join(ROOT, rel)) ? read(rel) : null);

/** Files whose absence should stop the run outright rather than produce ten confusing failures. */
const REQUIRED = [
  'CLAUDE.md',
  'README.md',
  'docs/05-API-Spec.md',
  'docs/07-Roadmap.md',
  'docs/10-Build-Log.md',
  'docs/schema.sql',
  'apps/api/src/platform/errors.ts',
  'apps/api/prisma/seed/reference.ts',
];

function walk(rel, out = []) {
  const abs = join(ROOT, rel);
  if (!existsSync(abs)) return out;
  for (const entry of readdirSync(abs, { withFileTypes: true })) {
    const child = `${rel}/${entry.name}`;
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules' || entry.name === 'generated' || entry.name === 'dist')
        continue;
      walk(child, out);
    } else out.push(child);
  }
  return out;
}

// ---------------------------------------------------------------------------
// 1. The state line. One machine-readable claim the other checks are measured against.
// ---------------------------------------------------------------------------

/** `<!-- dis:state milestone=M1 schema=v1.7 tests=282 -->` at the top of the Build Log. */
function readState() {
  const log = read('docs/10-Build-Log.md');
  const match = /<!--\s*dis:state\s+([^>]*?)-->/.exec(log);
  if (!match) return null;
  const state = {};
  for (const pair of match[1].trim().split(/\s+/)) {
    const [key, value] = pair.split('=');
    if (key && value) state[key] = value;
  }
  return state;
}

function checkState(state) {
  if (!state) {
    fail(
      'state line',
      'docs/10-Build-Log.md has no `<!-- dis:state milestone=… schema=… tests=… -->` line. ' +
        'Every other check is measured against it, so nothing below can be trusted.',
    );
    return false;
  }
  const missing = ['milestone', 'schema', 'tests'].filter((k) => !state[k]);
  if (missing.length) {
    fail('state line', `dis:state is missing: ${missing.join(', ')}`);
    return false;
  }
  ok('state line', `milestone=${state.milestone} schema=${state.schema} tests=${state.tests}`);
  return true;
}

// ---------------------------------------------------------------------------
// 2. schema.sql version agrees everywhere it is quoted
// ---------------------------------------------------------------------------

function checkSchemaVersion(state) {
  const sql = read('docs/schema.sql');
  const versions = [...sql.matchAll(/^--\s*(v\d+\.\d+)/gm)].map((m) => m[1]);
  if (versions.length === 0) {
    fail('schema.sql version', 'No `-- vN.N` amendment header found in docs/schema.sql.');
    return;
  }
  const latest = versions
    .sort((a, b) => {
      const [aMaj, aMin] = a.slice(1).split('.').map(Number);
      const [bMaj, bMin] = b.slice(1).split('.').map(Number);
      return aMaj - bMaj || aMin - bMin;
    })
    .at(-1);

  if (latest !== state.schema) {
    fail(
      'schema.sql version',
      `dis:state says schema=${state.schema}, but the newest amendment header in ` +
        `docs/schema.sql is ${latest}.`,
    );
    return;
  }

  const quoting = [
    ['CLAUDE.md', read('CLAUDE.md')],
    ['docs/10-Build-Log.md', read('docs/10-Build-Log.md')],
    ['docs/07-Roadmap.md', read('docs/07-Roadmap.md')],
    ['docs/11-Build-Conventions.md', readIf('docs/11-Build-Conventions.md') ?? ''],
  ];
  const stale = [];
  for (const [name, text] of quoting) {
    for (const m of text.matchAll(/schema\.sql[^.\n]{0,40}?(v\d+\.\d+)/g)) {
      if (m[1] !== latest) stale.push(`${name} says ${m[1]}`);
    }
    for (const m of text.matchAll(/(v\d+\.\d+)[^.\n]{0,30}?schema\.sql/g)) {
      if (m[1] !== latest) stale.push(`${name} says ${m[1]}`);
    }
  }
  if (stale.length) {
    fail('schema.sql version', `schema.sql is ${latest}; these disagree`, [...new Set(stale)]);
  } else {
    ok('schema.sql version', `${latest}, and every document that quotes it agrees`);
  }
}

// ---------------------------------------------------------------------------
// 3. Permissions: the seed is the authority
// ---------------------------------------------------------------------------

function seededPermissions() {
  const seed = read('apps/api/prisma/seed/reference.ts');
  const block = seed.slice(seed.indexOf('PERMISSIONS'));
  const end = block.indexOf('\n];');
  return new Set([...block.slice(0, end).matchAll(/code:\s*'([a-z]+:[a-z:]+)'/g)].map((m) => m[1]));
}

function checkPermissions() {
  const seeded = seededPermissions();
  if (seeded.size === 0) {
    fail('permissions', 'Could not parse PERMISSIONS out of apps/api/prisma/seed/reference.ts.');
    return;
  }
  const spec = read('docs/05-API-Spec.md');
  const cited = new Set(
    [...spec.matchAll(/`([a-z]+:[a-z:]+)`/g)]
      .map((m) => m[1])
      .filter((c) => c.split(':').length >= 3),
  );

  const ghosts = [...cited].filter((c) => !seeded.has(c));
  const undocumented = [...seeded].filter((c) => !cited.has(c));

  if (ghosts.length) {
    fail(
      'permissions → spec',
      `${ghosts.length} permission(s) cited in the API spec are not seeded`,
      ghosts,
    );
  } else {
    ok('permissions → spec', `all ${cited.size} codes cited in the spec exist in the seed`);
  }

  if (undocumented.length) {
    fail(
      'permissions ← code',
      `${undocumented.length} seeded permission(s) appear nowhere in docs/05-API-Spec.md. ` +
        'A permission nobody documented is a permission nobody reviews.',
      undocumented,
    );
  } else {
    ok('permissions ← code', `all ${seeded.size} seeded codes appear in the spec`);
  }

  // The prose counts drift the moment a milestone adds a permission.
  const claims = [];
  for (const [file, text] of [
    ['README.md', read('README.md')],
    ['docs/10-Build-Log.md', read('docs/10-Build-Log.md')],
  ]) {
    for (const m of text.matchAll(/(\d+)\s+permissions/g)) {
      if (Number(m[1]) !== seeded.size)
        claims.push(`${file} says ${m[1]}, seed has ${seeded.size}`);
    }
  }
  if (claims.length) fail('permission count', 'prose disagrees with the seed', claims);
  else ok('permission count', `${seeded.size}, everywhere it is stated`);
}

// ---------------------------------------------------------------------------
// 4. Error codes: platform/errors.ts is the authority
// ---------------------------------------------------------------------------

function checkErrorCodes() {
  const src = read('apps/api/src/platform/errors.ts');
  const block = src.slice(src.indexOf('export const ErrorCode'));
  const declared = new Set(
    [...block.slice(0, block.indexOf('\n}')).matchAll(/^\s*([A-Z][A-Z0-9_]*)\s*:/gm)].map(
      (m) => m[1],
    ),
  );
  if (declared.size === 0) {
    fail('error codes', 'Could not parse ErrorCode out of apps/api/src/platform/errors.ts.');
    return;
  }

  const spec = read('docs/05-API-Spec.md');
  const builtSection =
    /\*\*Built:\*\*([\s\S]*?)\*\*Designed, not yet built:\*\*([\s\S]*?)\n\n/.exec(spec);
  if (!builtSection) {
    fail(
      'error codes',
      'docs/05-API-Spec.md §1 has no `**Built:**` / `**Designed, not yet built:**` pair. ' +
        'That split is what this check reads; without it the spec cannot be verified.',
    );
    return;
  }
  const listed = new Set([...builtSection[1].matchAll(/`([A-Z][A-Z0-9_]+)`/g)].map((m) => m[1]));
  const designed = new Set([...builtSection[2].matchAll(/`([A-Z][A-Z0-9_]+)`/g)].map((m) => m[1]));

  // Auth codes are covered by §2 rather than repeated in the §1 list.
  const authCodes = new Set([
    'UNAUTHENTICATED',
    'INVALID_CREDENTIALS',
    'ACCOUNT_LOCKED',
    'ACCOUNT_NOT_ACTIVE',
    'RATE_LIMITED',
    'TOKEN_INVALID',
    'TOKEN_EXPIRED',
    'MFA_REQUIRED',
    'MFA_INVALID',
    'MFA_ALREADY_ENABLED',
    'MFA_NOT_ENROLLED',
    'INTERNAL_ERROR',
  ]);

  const missing = [...declared].filter((c) => !listed.has(c) && !authCodes.has(c));
  const ghosts = [...listed].filter((c) => !declared.has(c));
  const contradictions = [...designed].filter((c) => declared.has(c));

  const problems = [];
  if (missing.length) problems.push(`built but undocumented: ${missing.join(', ')}`);
  if (ghosts.length)
    problems.push(`documented as built but absent from errors.ts: ${ghosts.join(', ')}`);
  if (contradictions.length)
    problems.push(`listed as NOT built but present in errors.ts: ${contradictions.join(', ')}`);

  if (problems.length)
    fail('error codes', 'docs/05-API-Spec.md §1 disagrees with errors.ts', problems);
  else ok('error codes', `${declared.size} declared, and the spec's built/designed split matches`);
}

// ---------------------------------------------------------------------------
// 5. Every registered route appears in the spec
// ---------------------------------------------------------------------------

function registeredRoutes() {
  const routes = [];
  for (const file of walk('apps/api/src/modules').filter((f) => f.endsWith('routes.ts'))) {
    const src = read(file);
    for (const m of src.matchAll(/\.(get|post|patch|put|delete)\(\s*'([^']+)'/g)) {
      routes.push({ verb: m[1].toUpperCase(), path: m[2], file });
    }
  }
  return routes;
}

function checkRoutesDocumented() {
  const routes = registeredRoutes();
  if (routes.length === 0) {
    fail('routes → spec', 'Found no routes at all — the extraction pattern has probably drifted.');
    return;
  }
  const spec = read('docs/05-API-Spec.md');
  // Compare on the path SHAPE. Three differences are not drift and must not be reported as
  // it: the spec writes the mounted path (`/auth/login`) where the router writes the path
  // within its router (`/login`); parameter names differ (`:id` vs `:positionId`); and the
  // spec collapses an optional trailing segment into `[/:appointmentId]`.
  const normalise = (p) => p.replace(/:[A-Za-z]+/g, ':x').replace(/\/$/, '');
  const documented = [...spec.matchAll(/`(\/[A-Za-z0-9/:_[\]-]*)`/g)].flatMap((m) =>
    // `[/:appointmentId]` documents the route with the segment AND the route without it, so
    // one spec row legitimately covers several registered paths.
    m[1].includes('[')
      ? [normalise(m[1].replace(/[[\]]/g, '')), normalise(m[1].replace(/\[[^\]]*\]/g, ''))]
      : [normalise(m[1])],
  );

  const undocumented = routes.filter((r) => {
    const path = normalise(r.path);
    return !documented.some((d) => d === path || d.endsWith(path));
  });
  if (undocumented.length) {
    fail(
      'routes → spec',
      `${undocumented.length} registered route(s) appear nowhere in docs/05-API-Spec.md`,
      undocumented.map((r) => `${r.verb} ${r.path}   (${r.file})`),
    );
  } else {
    ok('routes → spec', `all ${routes.length} registered routes appear in the spec`);
  }
}

// ---------------------------------------------------------------------------
// 6. The Build Log's code map names files that exist, and names all of them
// ---------------------------------------------------------------------------

function codeMapPaths() {
  const log = read('docs/10-Build-Log.md');
  const section = log.slice(log.indexOf('## 3. What exists in code'));
  const fence = /```([\s\S]*?)```/.exec(section);
  if (!fence) return null;

  const paths = [];
  const stack = []; // { indent, prefix }
  for (const line of fence[1].split('\n')) {
    if (!line.trim()) continue;
    const indent = line.length - line.trimStart().length;
    const token = line.trim().split(/\s+/)[0];
    if (!token || token.startsWith('·')) continue;

    while (stack.length && stack.at(-1).indent >= indent) stack.pop();
    const prefix = stack.length ? stack.at(-1).prefix : '';

    if (token.endsWith('/')) {
      stack.push({ indent, prefix: prefix + token });
      continue;
    }
    // `positions.{repository,service}` → two files
    const brace = /^(.*)\{([^}]+)\}(.*)$/.exec(token);
    const names = brace
      ? brace[2].split(',').map((part) => `${brace[1]}${part}${brace[3]}`)
      : [token];
    for (const name of names) {
      if (!/\.[a-z]+$/.test(name)) continue;
      paths.push({ path: prefix + name, raw: name });
    }
  }
  return paths;
}

function checkCodeMap() {
  const mapped = codeMapPaths();
  if (!mapped) {
    fail('code map', 'No fenced block found under `## 3. What exists in code` in the Build Log.');
    return;
  }

  // The map writes `positions.{repository,service}` and `audit.ts` alike — the extension is
  // dropped where the brace form would make it noise. Try both.
  const phantom = mapped.filter(
    (entry) =>
      !['', '.ts', '.tsx', 'x'].some((suffix) => existsSync(join(ROOT, entry.path + suffix))),
  );
  if (phantom.length) {
    fail(
      'code map → disk',
      `${phantom.length} path(s) in the Build Log code map do not exist`,
      phantom.map((p) => p.path),
    );
  } else {
    ok('code map → disk', `all ${mapped.length} documented paths exist`);
  }

  // The direction that actually catches a milestone: source added, never written down.
  const sources = [
    ...walk('apps/api/src/platform'),
    ...walk('apps/api/src/modules'),
    // The worker and its job definitions. Added in M2 session 1 — without it, an entire
    // directory of the API is invisible to the check whose whole purpose is to notice
    // code that was written and never written down.
    ...walk('apps/api/src/jobs'),
    ...walk('apps/web/src'),
  ].filter(
    (f) =>
      /\.(ts|tsx)$/.test(f) &&
      !f.includes('.test.') &&
      !f.endsWith('/index.ts') &&
      !f.includes('/generated/'),
  );
  // Searched as text rather than against the parsed map, because the map legitimately writes
  // a directory's files on one line — `auth/  routes · service · repository · tokens` — and
  // insisting on a parseable tree would make the document worse to read in order to make it
  // easier to check. Braces are expanded first so `positions.{repository,service}` counts as
  // naming both. A stem appearing in unrelated prose is a false negative this accepts: the
  // check is a prompt to look, not a proof.
  const mapText = read('docs/10-Build-Log.md').replace(/([\w.-]+)\{([^}]+)\}/g, (_, stem, parts) =>
    parts
      .split(',')
      .map((p) => stem + p)
      .join(' '),
  );
  const undocumented = sources.filter(
    (f) =>
      !mapText.includes(
        f
          .split('/')
          .pop()
          .replace(/\.tsx?$/, ''),
      ),
  );
  if (undocumented.length) {
    warn(
      'code map ← disk',
      `${undocumented.length} source file(s) are not named anywhere in the Build Log`,
      undocumented,
    );
  } else {
    ok('code map ← disk', `all ${sources.length} source files are accounted for`);
  }
}

// ---------------------------------------------------------------------------
// 7. Test count
// ---------------------------------------------------------------------------

function checkTestCount(state) {
  const reportPath = join(ROOT, '.tmp/vitest-report.json');
  const claimed = Number(state.tests);

  const prose = [];
  for (const [file, text] of [
    ['README.md', read('README.md')],
    ['docs/10-Build-Log.md', read('docs/10-Build-Log.md')],
  ]) {
    for (const m of text.matchAll(/\*\*(\d+)\s+tests\*\*/g)) {
      if (Number(m[1]) !== claimed) prose.push(`${file} says ${m[1]}, dis:state says ${claimed}`);
    }
  }
  if (prose.length) fail('test count (prose)', 'prose disagrees with dis:state', prose);
  else ok('test count (prose)', `${claimed}, consistent with dis:state`);

  if (!existsSync(reportPath)) {
    skip(
      'test count (measured)',
      'No .tmp/vitest-report.json. Run `npm run test:report` first — until then the ' +
        `claim of ${claimed} tests is unverified, not verified.`,
    );
    return;
  }
  const newestSource = Math.max(
    ...[...walk('apps/api/src'), ...walk('apps/web/src'), ...walk('packages')]
      .filter((f) => /\.(ts|tsx)$/.test(f))
      .map((f) => statSync(join(ROOT, f)).mtimeMs),
  );
  if (statSync(reportPath).mtimeMs < newestSource) {
    warn(
      'test count (measured)',
      'vitest report is older than the newest source file — rerun `npm run test:report`.',
    );
    return;
  }
  let actual;
  try {
    const report = JSON.parse(readFileSync(reportPath, 'utf8'));
    actual = report.numTotalTests ?? report.numPassedTests;
  } catch {
    warn('test count (measured)', 'Could not parse .tmp/vitest-report.json.');
    return;
  }
  if (actual !== claimed)
    fail('test count (measured)', `vitest ran ${actual} tests; docs claim ${claimed}`);
  else ok('test count (measured)', `${actual} tests, measured`);
}

// ---------------------------------------------------------------------------
// 8. Axiom conformance — the greppable half
// ---------------------------------------------------------------------------

/**
 * These cannot prove an axiom holds. They prove the specific, mechanical ways each one has
 * been broken before, or would most plausibly be broken by someone moving fast. The
 * judgement half belongs in the milestone's axiom-conformance review.
 */
function checkAxioms() {
  const prismaSchema = readIf('apps/api/prisma/schema.prisma') ?? '';
  const problems = [];

  // Axiom 2 — district affiliation is temporal.
  const clubModel = /model Club\s*\{([\s\S]*?)\n\}/.exec(prismaSchema);
  if (clubModel && /^\s*districtId\s/m.test(clubModel[1])) {
    problems.push(
      'AXIOM 2: `Club` has a districtId field. Affiliation is temporal — see club_district_affiliations.',
    );
  }

  // Axiom 3 — membership is an append-only event log.
  for (const file of walk('apps/api/src/modules')) {
    if (!/\.ts$/.test(file) || file.includes('.test.')) continue;
    const src = read(file);
    if (/\bmembershipEvent\.(update|delete|upsert|updateMany|deleteMany)\b/.test(src))
      problems.push(`AXIOM 3: ${file} mutates membershipEvent.`);
    if (/\bclubRoster\.(create|update|delete|upsert|createMany|updateMany|deleteMany)\b/.test(src))
      problems.push(`AXIOM 3: ${file} writes to clubRoster, which is a derived view.`);
  }

  // Convention — raw SQL only in assessment resolvers.
  for (const file of walk('apps/api/src')) {
    if (!/\.ts$/.test(file) || file.includes('.test.')) continue;
    if (file.includes('/modules/assessment/resolvers/')) continue;
    if (file.includes('/platform/')) continue; // the layer that owns the client
    if (file.includes('/src/test/')) continue; // fixtures truncate tables; that is their job
    if (/\$queryRaw|\$executeRaw/.test(read(file)))
      problems.push(`CONVENTION: ${file} uses raw SQL outside modules/assessment/resolvers/.`);
  }

  // Money and time, in the schema Prisma owns.
  if (/@db\.(DoublePrecision|Real)\b/.test(prismaSchema))
    problems.push('CONVENTION: schema.prisma uses a float type. Money is NUMERIC.');
  for (const m of prismaSchema.matchAll(/@db\.Timestamp\((\d+)\)/g))
    problems.push(
      `CONVENTION: schema.prisma has @db.Timestamp(${m[1]}) — timestamps are TIMESTAMPTZ.`,
    );

  // Axiom 6 — no unauthenticated personal data. The harness proves the runtime; this
  // proves nobody has quietly widened what the harness looks for.
  const noPii = readIf('apps/api/src/platform/no-pii.test.ts');
  if (!noPii) problems.push('AXIOM 6: apps/api/src/platform/no-pii.test.ts is missing.');
  else if (!/email/i.test(noPii) || !/phone/i.test(noPii))
    problems.push(
      'AXIOM 6: the no-PII harness no longer names email and phone among the fields it forbids.',
    );

  if (problems.length) fail('axiom conformance (mechanical)', 'the greppable invariants', problems);
  else
    ok('axiom conformance (mechanical)', 'no axiom broken in any of the ways that can be grepped');
}

// ---------------------------------------------------------------------------
// 8a. Cross-references between documents point at documents that exist
// ---------------------------------------------------------------------------

/**
 * A pointer to a document that was planned and never written reads exactly like a pointer
 * to one that exists, and the reader loses either way — they either hunt for it or assume
 * they have missed something. Cheap to check, so check it.
 */
function checkCrossReferences() {
  const docs = ['CLAUDE.md', 'README.md', ...walk('docs').filter((f) => f.endsWith('.md'))];
  const broken = [];
  for (const doc of docs) {
    const text = read(doc);
    const referenced = new Set([
      ...[...text.matchAll(/`(docs\/[\w.-]+\.(?:md|sql))`/g)].map((m) => m[1]),
      ...[...text.matchAll(/\]\((?!https?:)([\w./-]+\.(?:md|sql))[)#]/g)].map((m) => m[1]),
      // Bare filenames in prose: `read 11a-Build-Conventions-Addendum-M1.md alongside this`.
      ...[...text.matchAll(/\b(\d\d[\w-]*\.md)\b/g)].map((m) => `docs/${m[1]}`),
    ]);
    for (const target of referenced) {
      const candidates = [target, join('docs', target), target.replace(/^docs\//, '')];
      if (!candidates.some((c) => existsSync(join(ROOT, c)))) broken.push(`${doc} → ${target}`);
    }
  }
  if (broken.length) {
    fail(
      'cross-references',
      `${broken.length} pointer(s) name a document that does not exist`,
      broken,
    );
  } else {
    ok('cross-references', 'every document referenced by another document exists');
  }
}

// ---------------------------------------------------------------------------
// 9. Deferred items whose milestone has arrived
// ---------------------------------------------------------------------------

function checkDeferred(state) {
  const log = read('docs/10-Build-Log.md');
  const section = log.slice(log.indexOf('## 5. Deliberately unfinished'));
  const table = section.slice(
    0,
    section.indexOf('\n## ') === -1 ? undefined : section.indexOf('\n## '),
  );
  const current = Number((state.milestone ?? 'M0').replace(/\D/g, ''));

  const due = [];
  for (const line of table.split('\n')) {
    if (!line.startsWith('|') || line.includes('---')) continue;
    const cells = line.split('|').map((c) => c.trim());
    const lands = cells.at(-2) ?? '';
    // `carried` marks a row consciously held open past its milestone — the item stays
    // visible without failing every close from here on. The word is required to sit next to
    // a reason in the row itself; a bare `carried` is a lie with extra steps.
    if (/\bcarried\b/i.test(lands)) continue;
    const m = /M(\d+)/.exec(lands);
    if (m && Number(m[1]) <= current) due.push(`${cells[1]}  →  ${lands}`);
  }
  if (due.length) {
    warn(
      'deferred items',
      `${due.length} row(s) in §5 name a milestone that has arrived — build them, or move the row's target out`,
      due,
    );
  } else {
    ok('deferred items', 'no row in §5 is overdue');
  }
}

// ---------------------------------------------------------------------------
// 10. schema.sql actually rebuilds to the migrated database (needs --with-db)
// ---------------------------------------------------------------------------

/** psql is not on PATH on the development machine; the PostgreSQL 17 install is not either. */
function findPsql() {
  for (const candidate of ['psql', 'C:/Program Files/PostgreSQL/17/bin/psql.exe']) {
    try {
      execFileSync(candidate, ['--version'], { stdio: 'pipe' });
      return candidate;
    } catch {
      /* try the next one */
    }
  }
  return null;
}

function checkSchemaRebuild() {
  if (!WITH_DB) {
    skip(
      'schema.sql → database',
      'Pass --with-db to rebuild docs/schema.sql into dis_schema_check and diff the ' +
        'catalogs. This is the check that found the `session` table missing since M0.',
    );
    return;
  }
  const env = readIf('apps/api/.env');
  const url = env && /^DATABASE_URL="?([^"\n]+)"?/m.exec(env)?.[1];
  if (!url) {
    warn('schema.sql → database', 'Could not read DATABASE_URL from apps/api/.env.');
    return;
  }
  const psql = findPsql();
  if (!psql) {
    warn(
      'schema.sql → database',
      'psql not found on PATH or at the PostgreSQL 17 install path. This check is the only ' +
        'thing that proves docs/schema.sql rebuilds to the migrated database — it must not ' +
        'be left unproven at a milestone boundary.',
    );
    return;
  }
  const checkUrl = url.replace(/\/[^/?]+(\?|$)/, '/dis_schema_check$1');
  const columns = (dbUrl) =>
    execFileSync(
      psql,
      [
        dbUrl,
        '-At',
        '-c',
        "select table_name||'.'||column_name||':'||data_type from information_schema.columns " +
          "where table_schema='public' and table_name <> '_prisma_migrations' order by 1",
      ],
      { encoding: 'utf8' },
    ).trim();

  try {
    execFileSync(
      psql,
      [checkUrl, '-q', '-c', 'drop schema public cascade; create schema public;'],
      {
        stdio: 'pipe',
      },
    );
    execFileSync(
      psql,
      [checkUrl, '-q', '-v', 'ON_ERROR_STOP=1', '-f', join(ROOT, 'docs/schema.sql')],
      {
        stdio: 'pipe',
      },
    );
    const fromDoc = columns(checkUrl);
    const fromMigrations = columns(url);
    if (fromDoc === fromMigrations) {
      ok('schema.sql → database', `identical, ${fromDoc.split('\n').length} columns`);
    } else {
      const a = new Set(fromDoc.split('\n'));
      const b = new Set(fromMigrations.split('\n'));
      fail('schema.sql → database', 'docs/schema.sql does not rebuild to the migrated database', [
        ...[...b].filter((x) => !a.has(x)).map((x) => `only in migrations: ${x}`),
        ...[...a].filter((x) => !b.has(x)).map((x) => `only in schema.sql:  ${x}`),
      ]);
    }
  } catch (error) {
    warn('schema.sql → database', `psql failed: ${String(error.message).split('\n')[0]}`);
  }
}

// ---------------------------------------------------------------------------

function main() {
  const missing = REQUIRED.filter((f) => !existsSync(join(ROOT, f)));
  if (missing.length) {
    console.error(`doc-check: required file(s) missing:\n  ${missing.join('\n  ')}`);
    process.exit(1);
  }

  const state = readState();
  if (checkState(state)) {
    checkSchemaVersion(state);
    checkTestCount(state);
    checkDeferred(state);
  }
  checkPermissions();
  checkErrorCodes();
  checkRoutesDocumented();
  checkCodeMap();
  checkAxioms();
  checkCrossReferences();
  checkSchemaRebuild();

  const glyph = { ok: '  ok  ', fail: ' FAIL ', warn: ' warn ', skip: ' skip ' };
  console.log('\ndoc-check — does the documentation still describe the system?\n');
  for (const r of results) {
    console.log(`[${glyph[r.status]}] ${r.name}\n            ${r.detail}`);
    for (const item of r.items ?? []) console.log(`              · ${item}`);
  }

  const failed = results.filter((r) => r.status === 'fail');
  const warned = results.filter((r) => r.status === 'warn');
  const skipped = results.filter((r) => r.status === 'skip');
  console.log(
    `\n${results.filter((r) => r.status === 'ok').length} ok · ${failed.length} failed · ` +
      `${warned.length} warned · ${skipped.length} skipped (proved nothing)\n`,
  );

  if (failed.length || (STRICT && (warned.length || skipped.length))) {
    console.log(
      STRICT
        ? 'Strict mode: a warning or a skip is a failure. Nothing may be left unproven at a milestone boundary.\n'
        : 'Run with --strict at a milestone boundary.\n',
    );
    process.exit(1);
  }
}

main();
