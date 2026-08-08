import { getEnv } from '@/server/env';
import { getLogger } from '@/server/logging/logger';
import { resolveCorrelationId } from '@/server/logging/correlation';
import { findStoreByHash } from '@/repositories/store-repository';
import { findStoreUser, upsertStoreUser } from '@/repositories/user-repository';
import { recordAuditEvent } from '@/repositories/audit-repository';
import { verifyBigCommerceCallbackJwt, requireStoreHash } from '@/lib/bigcommerce/callbacks';
import { issueBootstrapCode } from '@/server/session/bootstrap';
import { htmlResponse, renderResultPage } from '@/lib/bigcommerce/html-templates';
import { toAppError } from '@/server/errors/app-error';
import type { StoreUserRole } from '@prisma/client';

export const dynamic = 'force-dynamic';

function errorPage(message: string, status: number): Response {
  return htmlResponse(
    renderResultPage({
      title: 'Unable to load app',
      heading: 'This app can’t be loaded right now',
      message,
      tone: 'error',
    }),
    status,
  );
}

export async function GET(request: Request): Promise<Response> {
  const correlationId = resolveCorrelationId(request.headers.get('x-request-id'));
  const logger = getLogger().child({ correlationId, route: 'bigcommerce.load' });
  const env = getEnv();

  const url = new URL(request.url);
  const signedPayloadJwt = url.searchParams.get('signed_payload_jwt');
  if (!signedPayloadJwt) {
    return errorPage(
      'BigCommerce did not send a valid signed request. Please reopen the app.',
      400,
    );
  }

  try {
    const payload = await verifyBigCommerceCallbackJwt(signedPayloadJwt);
    const storeHash = requireStoreHash(payload);

    const store = await findStoreByHash(storeHash);
    if (!store) {
      logger.warn({ storeHash }, 'Load callback for unknown store');
      return errorPage(
        'This store is not installed. Please install the app from the BigCommerce Marketplace.',
        404,
      );
    }
    if (!store.isActive) {
      logger.info({ storeId: store.id }, 'Load callback for inactive store');
      return errorPage(
        'This app was uninstalled from this store. Please reinstall to continue.',
        403,
      );
    }

    const isOwner = payload.user.id === payload.owner.id;
    const role: StoreUserRole = isOwner ? 'OWNER' : 'USER';

    const existingUser = await findStoreUser(store.id, String(payload.user.id));
    if (existingUser && !existingUser.isActive) {
      logger.warn(
        { storeId: store.id, bigcommerceUserId: payload.user.id },
        'Load callback for removed user',
      );
      return errorPage('Your access to this app has been removed by the store owner.', 403);
    }

    const storeUser = await upsertStoreUser({
      storeId: store.id,
      bigcommerceUserId: String(payload.user.id),
      email: payload.user.email,
      role,
    });

    if (!existingUser) {
      await recordAuditEvent({
        storeId: store.id,
        storeUserId: storeUser.id,
        action: 'user.provisioned',
        entityType: 'store_user',
        entityId: storeUser.id,
        metadata: { role },
        correlationId,
      });
    }

    const bootstrap = await issueBootstrapCode(store.id, storeUser.id);

    const redirectUrl = new URL('/', env.APP_BASE_URL);
    redirectUrl.searchParams.set('bootstrap', bootstrap.code);

    return new Response(null, {
      status: 302,
      headers: { Location: redirectUrl.toString(), 'Cache-Control': 'no-store' },
    });
  } catch (error) {
    const appError = toAppError(error);
    logger.error(
      { code: appError.code, internalRef: appError.internalRef, err: appError.cause },
      'Load callback failed',
    );
    return errorPage(appError.message, appError.httpStatus >= 500 ? 502 : 400);
  }
}
