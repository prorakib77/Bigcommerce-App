import { z } from 'zod';
import { authedRoute, jsonOk } from '@/server/http/handler';
import { readJsonBody } from '@/server/http/body';
import { assertPermission, Permissions } from '@/server/authorization';
import { AppError } from '@/server/errors/app-error';
import { getProductForEdit, updateProductBasicFields } from '@/services/product-service';

export const dynamic = 'force-dynamic';

function parseProductId(raw: string | undefined): number {
  const id = Number(raw);
  if (!raw || !Number.isInteger(id) || id <= 0) throw new AppError('VALIDATION_FAILED');
  return id;
}

export const GET = authedRoute(async (_request, ctx) => {
  assertPermission(ctx.session, Permissions.VIEW);
  const productId = parseProductId(ctx.params.productId);

  const result = await getProductForEdit(
    ctx.session.storeId,
    productId,
    ctx.correlationId,
    ctx.logger,
  );
  return jsonOk(result, ctx.requestId);
});

const putBodySchema = z.object({
  name: z.string().trim().min(1).max(250).optional(),
  // Decimal string end-to-end, matching this codebase's price-handling
  // convention — never parsed to a JS number until the BigCommerce request
  // boundary (see src/lib/bigcommerce/catalog.ts's decimalStringToNumber).
  price: z.string().regex(/^\d+(\.\d{1,4})?$/, 'price must be a non-negative decimal string').optional(),
  description: z.string().max(100_000).optional(),
  isVisible: z.boolean().optional(),
});

export const PUT = authedRoute(async (request, ctx) => {
  assertPermission(ctx.session, Permissions.MANAGE_IMPORTS);
  const productId = parseProductId(ctx.params.productId);

  const parsed = putBodySchema.safeParse(await readJsonBody(request));
  if (!parsed.success) throw new AppError('VALIDATION_FAILED');

  const updated = await updateProductBasicFields(
    ctx.session.storeId,
    ctx.session.storeUserId,
    productId,
    parsed.data,
    ctx.correlationId,
    ctx.logger,
  );

  return jsonOk(updated, ctx.requestId);
});
