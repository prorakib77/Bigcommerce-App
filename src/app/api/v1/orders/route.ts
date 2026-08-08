import { z } from 'zod';
import { authedRoute, jsonOk } from '@/server/http/handler';
import { assertPermission, Permissions } from '@/server/authorization';
import { AppError } from '@/server/errors/app-error';
import { listOrdersForStore } from '@/services/order-service';

export const dynamic = 'force-dynamic';

const getQuerySchema = z.object({
  cursor: z.string().nullable(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const GET = authedRoute(async (request, ctx) => {
  assertPermission(ctx.session, Permissions.VIEW);

  const url = new URL(request.url);
  const parsed = getQuerySchema.safeParse({
    cursor: url.searchParams.get('cursor'),
    limit: url.searchParams.get('limit') ?? undefined,
  });
  if (!parsed.success) throw new AppError('VALIDATION_FAILED');

  const page = await listOrdersForStore(ctx.session.storeId, {
    cursor: parsed.data.cursor ?? undefined,
    limit: parsed.data.limit,
  });

  return jsonOk(page.items, ctx.requestId, { meta: { nextCursor: page.nextCursor } });
});
