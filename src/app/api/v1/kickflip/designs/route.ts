import { z } from 'zod';
import { authedRoute, jsonOk } from '@/server/http/handler';
import { assertPermission, Permissions } from '@/server/authorization';
import { AppError } from '@/server/errors/app-error';
import { listDesignsWithMappingStatus } from '@/services/design-service';

export const dynamic = 'force-dynamic';

const querySchema = z.object({
  cursor: z.string().nullable().default(null),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const GET = authedRoute(async (request, ctx) => {
  assertPermission(ctx.session, Permissions.VIEW);

  const url = new URL(request.url);
  const parsed = querySchema.safeParse({
    cursor: url.searchParams.get('cursor'),
    limit: url.searchParams.get('limit') ?? undefined,
  });
  if (!parsed.success) throw new AppError('VALIDATION_FAILED');

  const result = await listDesignsWithMappingStatus(
    ctx.session.storeId,
    { cursor: parsed.data.cursor, limit: parsed.data.limit },
    ctx.logger,
  );

  return jsonOk(result.items, ctx.requestId, {
    meta: { nextCursor: result.nextCursor, skippedCount: result.skippedCount },
  });
});
