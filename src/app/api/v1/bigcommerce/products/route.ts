import { z } from 'zod';
import { authedRoute, jsonOk } from '@/server/http/handler';
import { assertPermission, Permissions } from '@/server/authorization';
import { AppError } from '@/server/errors/app-error';
import { listProductsForStore } from '@/services/product-service';

export const dynamic = 'force-dynamic';

const getQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  limit: z.coerce.number().int().min(1).max(250).default(20),
  search: z.string().trim().min(1).max(200).nullable(),
});

export const GET = authedRoute(async (request, ctx) => {
  assertPermission(ctx.session, Permissions.VIEW);

  const url = new URL(request.url);
  const parsed = getQuerySchema.safeParse({
    page: url.searchParams.get('page') ?? undefined,
    limit: url.searchParams.get('limit') ?? undefined,
    search: url.searchParams.get('search'),
  });
  if (!parsed.success) throw new AppError('VALIDATION_FAILED');

  const result = await listProductsForStore(
    ctx.session.storeId,
    { page: parsed.data.page, limit: parsed.data.limit, search: parsed.data.search ?? undefined },
    ctx.correlationId,
    ctx.logger,
  );

  return jsonOk(result.items, ctx.requestId, {
    meta: { currentPage: result.currentPage, totalPages: result.totalPages },
  });
});
