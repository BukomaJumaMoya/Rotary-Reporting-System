import { createHash } from 'node:crypto';
import { existsSync, readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { PREPAINT_SCRIPT_HASH } from './security-headers.js';

/**
 * THE CSP HASH AND THE SCRIPT IT ADMITS MUST NOT DRIFT APART.
 *
 * `apps/web/index.html` carries one inline script — the pre-paint theme and sidebar
 * resolver — and the policy admits it by SHA-256 rather than by `'unsafe-inline'`. That is
 * the right trade, but it couples two files in different workspaces, and the failure mode is
 * silent: edit the script, forget the hash, and the browser refuses to run it. Nothing
 * throws. The application still works. It just flashes white before going dark, on the first
 * paint of every cold load, which is precisely the defect the inline script exists to
 * prevent.
 *
 * No test that asserted "the header contains a hash" would catch that. This one recomputes
 * the hash from the file on disk, which is the only version of the check that can fail for
 * the right reason.
 */

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));

/** The bytes a browser hashes: everything between the tags of a script with no `src`. */
function inlineScriptsIn(html: string): string[] {
  return [...html.matchAll(/<script(?![^>]*\bsrc=)[^>]*>([\s\S]*?)<\/script>/g)].map(
    (match) => match[1] ?? '',
  );
}

function sha256(source: string): string {
  return `'sha256-${createHash('sha256').update(source, 'utf8').digest('base64')}'`;
}

describe('the pre-paint script is admitted by the policy that ships with it', () => {
  const sourceHtml = readFileSync(`${repoRoot}apps/web/index.html`, 'utf8');

  it('hashes to exactly the value the CSP allows', () => {
    const scripts = inlineScriptsIn(sourceHtml);

    // If this fails at the count, someone added a second inline script. It needs its own
    // hash in `script-src`; it will not inherit this one.
    expect(scripts).toHaveLength(1);
    expect(sha256(scripts[0] ?? '')).toBe(PREPAINT_SCRIPT_HASH);
  });

  it('still matches after Vite has built the page', () => {
    // The API serves `dist/index.html` in production, not the source. Vite leaves a
    // non-module inline script alone today — but "today" is doing a lot of work in that
    // sentence, and a build-time rewrite would break the hash only in production.
    const built = `${repoRoot}apps/web/dist/index.html`;
    if (!existsSync(built)) {
      // Nothing has been built in this working tree. CI builds before it tests, so the
      // assertion below runs there; skipping locally is better than a false red.
      return;
    }

    const scripts = inlineScriptsIn(readFileSync(built, 'utf8'));
    expect(scripts).toHaveLength(1);
    expect(sha256(scripts[0] ?? '')).toBe(PREPAINT_SCRIPT_HASH);
  });

  it('does not admit inline script wholesale', () => {
    // The hash is only a defensible relaxation for as long as this stays true.
    expect(sourceHtml).toBeTruthy();
    expect(PREPAINT_SCRIPT_HASH).not.toContain('unsafe-inline');
  });
});
