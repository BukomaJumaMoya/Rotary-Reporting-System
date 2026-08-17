import { Prisma } from '../../generated/prisma/client.js';

/**
 * Money arithmetic, in one place.
 *
 * **Never a JavaScript number.** UGX figures run to nine digits and `0.1 + 0.2` is
 * `0.30000000000000004`; a float that reaches an award tally, a variance table or a receipt
 * is a number the district cannot defend when a club disputes it. Postgres holds
 * `NUMERIC(14,2)`, Prisma hands back `Decimal`, and the wire carries a decimal STRING.
 *
 * The conversion happens exactly twice — here on the way in, here on the way out — so there
 * is one place to look when a figure is wrong, rather than eleven call sites each having
 * done their own thing.
 */

export type Money = Prisma.Decimal;

export const ZERO: Money = new Prisma.Decimal(0);

/** A validated decimal string from a request body. */
export function toMoney(value: string): Money {
  return new Prisma.Decimal(value);
}

/**
 * On the wire, always as a string with exactly two decimal places.
 *
 * Fixed at 2 rather than `toString()`: Postgres returns `1500000` for a whole number and
 * `1500000.50` otherwise, so a client formatting the raw value would show "1500000" on one
 * row and "1500000.50" on the next. Money in a column should line up.
 */
export function fromMoney(value: Money | null | undefined): string {
  return (value ?? ZERO).toFixed(2);
}

export function sum(values: readonly Money[]): Money {
  return values.reduce<Money>((total, value) => total.add(value), ZERO);
}

/**
 * Variance, oriented so that **positive is good in both directions**.
 *
 * For expenditure that is planned − actual: spending less than planned is a surplus. For
 * income it is actual − planned: earning more than planned is a surplus. A single
 * subtraction would make half of a variance table mean the opposite of the other half, and
 * a treasurer reading down the column would have to remember which rows to invert — which
 * is precisely the sort of thing nobody remembers at eleven at night.
 */
export function variance(
  direction: 'INCOME' | 'EXPENDITURE',
  planned: Money,
  actual: Money,
): Money {
  return direction === 'INCOME' ? actual.sub(planned) : planned.sub(actual);
}
