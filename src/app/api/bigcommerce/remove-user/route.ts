import { getLogger } from '@/server/logging/logger';
import { resolveCorrelationId } from '@/server/logging/correlation';
import { prisma } from '@/server/db/prisma';
import { findStoreByHash } from '@/repositories/store-repository';
import { deactivateStoreUser } from '@/repositories/user-repository';
import { recordAuditEvent } from '@/repositories/audit-repository';
import { revokeSessionsForStoreUser } from '@/server/session';
import { verifyBigCommerceCallbackJwt, requireStoreHash } from '@/lib/bigcommerce/callbacks';
import { htmlResponse, renderResultPage } from '@/lib/bigcommerce/html-templates';
import { toAppError } from '@/server/errors/app-error';

export const dynamic = 'force-dynamic';

function resultPage(tone: 'success' | 'error', message: string, status: number): Response {
  return htmlResponse(
    renderResultPage({
      title: 'User access removed',
      heading: tone === 'success' ? 'Access removed' : 'Request could not be completed',
      message,
      tone,
    }),
    status,
  );
}

export async function GET(request: Request): Promise<Response> {
  const correlationId = resolveCorrelationId(request.headers.get('x-request-id'));
  const logger = getLogger().child({ correlationId, route: 'bigcommerce.remove-user' });

  const url = new URL(request.url);
  const signedPayloadJwt = url.searchParams.get('signed_payload_jwt');
  if (!signedPayloadJwt) {
    return resultPage('error', 'BigCommerce did not send a valid signed request.', 400);
  }

  try {
    const payload = await verifyBigCommerceCallbackJwt(signedPayloadJwt);
    const storeHash = requireStoreHash(payload);

    const store = await findStoreByHash(storeHash);
    if (!store) {
      logger.info({ storeHash }, 'Remove-user callback for unknown store, treating as no-op');
      return resultPage('success', 'This user no longer has access.', 200);
    }

    const removedUser = await prisma.$transaction(async (tx) => {
      const user = await deactivateStoreUser(store.id, String(payload.user.id));
      if (user) {
        await recordAuditEvent(
          {
            storeId: store.id,
            storeUserId: user.id,
            action: 'user.removed',
            entityType: 'store_user',
            entityId: user.id,
            correlationId,
          },
          tx,
        );
      }
      return user;
    });

    if (removedUser) {
      await revokeSessionsForStoreUser(removedUser.id);
    }

    logger.info({ storeId: store.id, bigcommerceUserId: payload.user.id }, 'Store user removed');
    return resultPage('success', 'This user’s access to the app has been removed.', 200);
  } catch (error) {
    const appError = toAppError(error);
    logger.error(
      { code: appError.code, internalRef: appError.internalRef, err: appError.cause },
      'Remove-user callback failed',
    );
    return resultPage('error', appError.message, appError.httpStatus >= 500 ? 502 : 400);
  }
}
