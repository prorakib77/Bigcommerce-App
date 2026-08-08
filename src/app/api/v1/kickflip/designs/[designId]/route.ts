import { authedRoute, jsonOk } from '@/server/http/handler';
import { assertPermission, Permissions } from '@/server/authorization';
import { AppError } from '@/server/errors/app-error';
import { getDesignWithMappingStatus } from '@/services/design-service';

export const dynamic = 'force-dynamic';

export const GET = authedRoute(async (_request, ctx) => {
  assertPermission(ctx.session, Permissions.VIEW);
  const designId = ctx.params.designId;
  if (!designId) throw new AppError('VALIDATION_FAILED');

  return jsonOk(
    await getDesignWithMappingStatus(ctx.session.storeId, designId, ctx.logger),
    ctx.requestId,
  );
});
