import { authedRoute, jsonOk } from '@/server/http/handler';
import { assertPermission, Permissions } from '@/server/authorization';
import { decryptSecret } from '@/server/crypto/encryption';
import { AppError } from '@/server/errors/app-error';
import { findStoreById } from '@/repositories/store-repository';
import { createCatalogService } from '@/lib/bigcommerce/catalog-service';

export const dynamic = 'force-dynamic';

export const GET = authedRoute(async (request, ctx) => {
  assertPermission(ctx.session, Permissions.VIEW);

  const store = await findStoreById(ctx.session.storeId);
  if (!store) throw new AppError('STORE_INACTIVE');

  const page = Number(new URL(request.url).searchParams.get('page') ?? '1') || 1;

  const catalogService = createCatalogService({
    storeHash: store.storeHash,
    accessToken: decryptSecret(store.encryptedAccessToken),
    correlationId: ctx.correlationId,
    logger: ctx.logger,
  });

  const result = await catalogService.listCategories(page);
  return jsonOk(result.items, ctx.requestId, {
    meta: { currentPage: result.currentPage, totalPages: result.totalPages },
  });
});
