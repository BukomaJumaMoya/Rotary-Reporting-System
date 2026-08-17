/**
 * money-safe: THIS FILE is the one permitted place a money string becomes a number, and it
 * does so only to hand the value to `Intl.NumberFormat`. `doc-check.mjs` forbids the
 * conversion everywhere else in the finance path; confining it here is the entire design,
 * and the marker above is what tells the check this file is the exception.
 *
 * Formatting money that arrives as a STRING.
 *
 * Every amount the API sends is a decimal string — `"1500000.50"` — because `NUMERIC(14,2)`
 * through a JSON number comes back as a float, and UGX figures run to nine digits. The rule
 * on this side is simple and absolute: **never parse one into a number to do arithmetic
 * with.** Formatting for display is the one permitted conversion, and it happens here.
 *
 * If a screen needs a total, the SERVER computes it. There is no client-side sum in this
 * application and there should not be one: a variance table that disagreed with the API by
 * a hundredth would be a bug nobody could reproduce.
 */

/**
 * `UGX 1,500,000.50`, in the member's own locale.
 *
 * `Intl.NumberFormat` does take a number, which is the conversion this module exists to
 * confine. It is safe HERE and only here: a double holds every integer up to 2^53, so a
 * fourteen-digit UGX figure with two decimals is exact for display, and nothing downstream
 * does arithmetic on the result. The moment somebody adds two of these together the
 * guarantee is gone — which is why `sum` does not exist in this file.
 */
export function formatMoney(amount: string, currencyCode = 'UGX'): string {
  const value = Number(amount);
  if (!Number.isFinite(value)) return `${currencyCode} ${amount}`;

  try {
    return new Intl.NumberFormat(undefined, {
      style: 'currency',
      currency: currencyCode,
      // UGX has no minor unit in practice, but the column does: a figure that rounds to
      // whole shillings on one row and shows cents on the next does not line up, and a
      // treasurer reading down a column is the whole audience for this.
      minimumFractionDigits: 2,
      maximumFractionDigits: 2,
    }).format(value);
  } catch {
    // An unknown currency code. Better a readable fallback than a thrown render.
    return `${currencyCode} ${amount}`;
  }
}

/** `1,500,000.50` — the same number without the code, for a column that has a header. */
export function formatAmount(amount: string): string {
  const value = Number(amount);
  if (!Number.isFinite(value)) return amount;
  return new Intl.NumberFormat(undefined, {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(value);
}

/**
 * Whether a money string is negative or zero, for choosing a colour.
 *
 * A COMPARISON, not arithmetic — and done on the string's own sign rather than by parsing,
 * so it stays true for figures beyond what a double can hold exactly.
 */
export function isNegative(amount: string): boolean {
  return amount.trimStart().startsWith('-');
}

export function isZero(amount: string): boolean {
  return /^-?0(\.0+)?$/.test(amount.trim());
}

/**
 * The tone a variance should be shown in.
 *
 * The API orients variance so POSITIVE IS GOOD in both directions — `actual − planned` for
 * income, `planned − actual` for expenditure. So this needs no knowledge of which way the
 * money went, which is exactly why the server does it that way.
 */
export function varianceTone(variance: string): 'success' | 'danger' | 'neutral' {
  if (isZero(variance)) return 'neutral';
  return isNegative(variance) ? 'danger' : 'success';
}
