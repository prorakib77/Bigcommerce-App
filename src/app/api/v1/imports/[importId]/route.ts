import { authedRoute, jsonOk } from '@/server/http/handler';
import { assertPermission, Permissions } from '@/server/authorization';
import { AppError } from '@/server/errors/app-error';
import { getImportRun } from '@/services/import-service';

export const dynamic = 'force-dynamic';

export const GET = authedRoute(async (_request, ctx) => {
  assertPermission(ctx.session, Permissions.VIEW);
  const importId = ctx.params.importId;
  if (!importId) throw new AppError('VALIDATION_FAILED');

  const run = await getImportRun(ctx.session.storeId, importId);
  return jsonOk(run, ctx.requestId);
});
