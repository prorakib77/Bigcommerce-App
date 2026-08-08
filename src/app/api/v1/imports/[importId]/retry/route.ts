import { authedRoute, jsonOk } from '@/server/http/handler';
import { assertPermission, Permissions } from '@/server/authorization';
import { AppError } from '@/server/errors/app-error';
import { retryImportRun } from '@/services/import-service';

export const dynamic = 'force-dynamic';

export const POST = authedRoute(async (_request, ctx) => {
  assertPermission(ctx.session, Permissions.MANAGE_IMPORTS);
  const importId = ctx.params.importId;
  if (!importId) throw new AppError('VALIDATION_FAILED');

  const run = await retryImportRun(
    ctx.session.storeId,
    ctx.session.storeUserId,
    importId,
    ctx.correlationId,
  );
  return jsonOk(run, ctx.requestId);
});
