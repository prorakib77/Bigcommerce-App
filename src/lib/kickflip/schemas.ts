import { z } from 'zod';

/**
 * Deliberately permissive: we validate only what the mapper needs and keep
 * everything else as passthrough. Real-world Kickflip responses may carry
 * additional fields we don't use — those should never break the import
 * pipeline. See docs/api-assumptions.md for the endpoint and shape this was
 * built against, and how to update it if the live API differs.
 */
export const rawKickflipImageSchema = z.union([z.string(), z.object({ url: z.string() }).loose()]);

export const rawKickflipDesignSchema = z
  .object({
    designId: z.union([z.string(), z.number()]),
    productId: z.union([z.string(), z.number()]).nullish(),
    customizerProductId: z.union([z.string(), z.number()]).nullish(),
    name: z.string().nullish(),
    price: z.union([z.string(), z.number()]).nullish(),
    currency: z.string().nullish(),
    currencyCode: z.string().nullish(),
    createdAt: z.string().nullish(),
    updatedAt: z.string().nullish(),
    images: z.array(rawKickflipImageSchema).nullish(),
    primaryImage: rawKickflipImageSchema.nullish(),
    options: z.array(z.object({ label: z.string(), value: z.string() }).loose()).nullish(),
  })
  .loose();
export type RawKickflipDesign = z.infer<typeof rawKickflipDesignSchema>;

/**
 * Confirmed against the real API (2026-08-02, gokickflip.com): the actual
 * envelope is `{ pagination: { collectionSize, resultSize, lastIndex,
 * sortOrder, sortKey }, results: [...] }` — an index/offset-based scheme,
 * not the cursor-token shape originally assumed from the brief alone (see
 * docs/api-assumptions.md). `data`/`cursor`/`meta` are kept as tolerated
 * fallbacks in case a different account/endpoint variant still uses them,
 * but `results` is what the live API actually returns.
 */
export const kickflipPaginationSchema = z
  .object({
    collectionSize: z.number().nullish(),
    resultSize: z.number().nullish(),
    lastIndex: z.number().nullish(),
    sortOrder: z.string().nullish(),
    sortKey: z.string().nullish(),
  })
  .loose();

export const kickflipDesignsResponseSchema = z
  .object({
    results: z.array(z.unknown()).nullish(),
    data: z.array(z.unknown()).nullish(),
    pagination: kickflipPaginationSchema.nullish(),
    cursor: z.string().nullish(),
    nextCursor: z.string().nullish(),
    hasMore: z.boolean().nullish(),
    meta: z
      .object({
        cursor: z.string().nullish(),
        nextCursor: z.string().nullish(),
        hasMore: z.boolean().nullish(),
      })
      .nullish(),
  })
  .loose()
  .refine((v) => v.results !== undefined || v.data !== undefined, {
    message: 'response must contain either "results" or "data"',
  });
export type KickflipDesignsResponse = z.infer<typeof kickflipDesignsResponseSchema>;

export const kickflipTestConnectionResponseSchema = z.looseObject({});
