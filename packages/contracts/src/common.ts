import { z } from 'zod';

/**
 * Shapes shared by every list endpoint (docs/05-API-Spec.md §1).
 *
 * Defined once because the alternative is twelve modules each inventing their own page
 * size, and a mobile client on metered data discovering the one that returns everything.
 */

/** `page` and `pageSize`. Default 25, hard maximum 100. */
export const paginationQuerySchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  pageSize: z.coerce.number().int().positive().max(100).default(25),
});
export type PaginationQuery = z.infer<typeof paginationQuerySchema>;

export const paginationMetaSchema = z.object({
  page: z.number().int().positive(),
  pageSize: z.number().int().positive(),
  total: z.number().int().nonnegative(),
});
export type PaginationMeta = z.infer<typeof paginationMetaSchema>;

/** `{ data: [...], meta: { page, pageSize, total } }` */
export function listResponseSchema<T extends z.ZodTypeAny>(item: T) {
  return z.object({ data: z.array(item), meta: paginationMetaSchema });
}

/** `{ data: { ... } }` */
export function singleResponseSchema<T extends z.ZodTypeAny>(item: T) {
  return z.object({ data: item });
}

/**
 * A boolean from a query string, where the value arrives as text.
 *
 * `?isActive=false` must mean false. Left to `z.coerce.boolean()` it would mean true,
 * because every non-empty string is truthy — a filter that silently inverts.
 */
export const booleanQuerySchema = z.enum(['true', 'false']).transform((value) => value === 'true');
