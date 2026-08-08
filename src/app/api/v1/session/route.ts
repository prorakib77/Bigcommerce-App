import { authedRoute, jsonOk } from '@/server/http/handler';
import { findStoreById } from '@/repositories/store-repository';
import { findStoreUserById } from '@/repositories/user-repository';
import { AppError } from '@/server/errors/app-error';

export const dynamic = 'force-dynamic';

export const GET = authedRoute(async (_request, ctx) => {
  const [store, storeUser] = await Promise.all([
    findStoreById(ctx.session.storeId),
    findStoreUserById(ctx.session.storeUserId),
  ]);

  if (!store || !storeUser) {
    throw new AppError('SESSION_EXPIRED');
  }

  return jsonOk(
    {
      storeHash: store.storeHash,
      role: storeUser.role,
      email: storeUser.email,
      isActive: store.isActive,
    },
    ctx.requestId,
  );
});
