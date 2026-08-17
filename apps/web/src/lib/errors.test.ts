import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { ApiError } from './api';
import { ERROR_SENTENCES, errorSentence, isRetryable } from './errors';

/**
 * EVERY CODE THE SERVER CAN SEND HAS A SENTENCE A CLUB SECRETARY CAN ACT ON.
 *
 * The failure this prevents is quiet and cumulative. Somebody adds a domain code in
 * `platform/errors.ts` — the right thing to do — and the web app falls back to the server's
 * developer-facing message. Nothing breaks, no test goes red, and the interface slowly fills
 * up with sentences written for a log file. Six months later half the error states in the
 * application are prose nobody would choose to show a user.
 *
 * So the list is read from the server's own source rather than duplicated here. A new code
 * fails this test until somebody writes the sentence, which is the moment they still have
 * the context to write a good one.
 */

const repoRoot = fileURLToPath(new URL('../../../../', import.meta.url));

/** The codes actually declared by the server, read from the file that defines them. */
function serverErrorCodes(): string[] {
  const source = readFileSync(`${repoRoot}apps/api/src/platform/errors.ts`, 'utf8');
  // The registry is `CODE: 'CODE',` entries — matching the pair keeps stray constants out.
  return [...source.matchAll(/^\s{2}([A-Z][A-Z0-9_]{2,}):\s*'\1',/gm)].map((match) => match[1]!);
}

describe('domain codes are written out for people', () => {
  const codes = serverErrorCodes();

  it('found the server’s error registry', () => {
    // Guards the regex itself: if the shape of errors.ts changes, this test would otherwise
    // pass vacuously by finding nothing to check.
    expect(codes.length).toBeGreaterThan(30);
    expect(codes).toContain('YEAR_LOCKED');
  });

  it('has a sentence for every one of them', () => {
    const missing = codes.filter((code) => !ERROR_SENTENCES[code]);
    expect(missing, `no sentence written for: ${missing.join(', ')}`).toEqual([]);
  });

  it('says what to do, not only what happened', () => {
    // A crude but effective proxy: a sentence that only diagnoses tends to be one clause.
    // Every sentence here should either give an instruction or name who can help.
    const tooTerse = Object.entries(ERROR_SENTENCES).filter(([, sentence]) => sentence.length < 40);
    expect(tooTerse.map(([code]) => code)).toEqual([]);
  });

  it('never leaks the code itself into the sentence', () => {
    // `PERIOD_CLOSED` appearing in its own message means somebody stopped halfway.
    for (const [code, sentence] of Object.entries(ERROR_SENTENCES)) {
      expect(sentence, code).not.toContain(code);
    }
  });
});

describe('errorSentence', () => {
  it('prefers the written sentence over the server’s message', () => {
    const error = new ApiError(423, 'YEAR_LOCKED', 'rotary year is locked');
    expect(errorSentence(error)).toContain('closed, so it can be read but not changed');
  });

  it('falls back to the server’s message for a code it does not know', () => {
    const error = new ApiError(400, 'SOME_NEW_CODE', 'A message written for a person.');
    expect(errorSentence(error)).toBe('A message written for a person.');
  });

  it('turns a bare fetch failure into the offline reassurance', () => {
    // `fetch` rejects with a TypeError when the network is gone. The raw message is
    // "Failed to fetch", which tells a secretary in Fort Portal nothing about whether their
    // report survived.
    expect(errorSentence(new TypeError('Failed to fetch'))).toContain('saved on this device');
  });

  it('has something to say about a thrown non-error', () => {
    expect(errorSentence({ weird: true })).toBeTruthy();
  });
});

describe('isRetryable', () => {
  it('offers a retry for the failures where retrying could work', () => {
    expect(isRetryable(new ApiError(500, 'INTERNAL_ERROR', ''))).toBe(true);
    expect(isRetryable(new ApiError(0, 'NETWORK_ERROR', ''))).toBe(true);
  });

  it('does not offer one where the answer will not change', () => {
    // Retrying a locked year just fails again, and a retry button that never works teaches
    // people to distrust every retry button.
    expect(isRetryable(new ApiError(423, 'YEAR_LOCKED', ''))).toBe(false);
    expect(isRetryable(new ApiError(403, 'INSUFFICIENT_SCOPE', ''))).toBe(false);
  });
});
