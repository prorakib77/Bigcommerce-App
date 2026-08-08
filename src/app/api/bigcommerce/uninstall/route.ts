import { getLogger } from '@/server/logging/logger';
import { resolveCorrelationId } from '@/server/logging/correlation';
import { prisma } from '@/server/db/prisma';
import { findStoreByHash, markStoreUninstalled } from '@/repositories/store-repository';
import { revokeSessionsForStore } from '@/server/session';
import { recordAuditEvent } from '@/repositories/audit-repository';
import { verifyBigCommerceCallbackJwt, requireStoreHash } from '@/lib/bigcommerce/callbacks';
import { htmlResponse, renderResultPage } from '@/lib/bigcommerce/html-templates';
import { toAppError } from '@/server/errors/app-error';

export const dynamic = 'force-dynamic';

function resultPage(tone: 'success' | 'error', message: string, status: number): Response {
  return htmlResponse(
    renderResultPage({
      title: 'App uninstalled',
      heading: tone === 'success' ? 'App uninstalled' : 'Uninstall could not be completed',
      message,
      tone,
    }),
    status,
  );
}

export async function GET(request: Request): Promise<Response> {
  const correlationId = resolveCorrelationId(request.headers.get('x-request-id'));
  const logger = getLogger().child({ correlationId, route: 'bigcommerce.uninstall' });

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
      // Nothing to do — treat as success so a retried/duplicate callback is idempotent.
      logger.info({ storeHash }, 'Uninstall callback for unknown store, treating as no-op');
      return resultPage('success', 'This app has been uninstalled.', 200);
    }

    await prisma.$transaction(async (tx) => {
      await markStoreUninstalled(storeHash, tx);

      // Halt anything not yet running. Jobs already in flight check store
      // activity before each external API write and stop themselves.
      await tx.importRun.updateMany({
        where: { storeId: store.id, status: 'QUEUED' },
        data: { status: 'CANCELLED', finishedAt: new Date() },
      });

      await recordAuditEvent(
        {
          storeId: store.id,
          action: 'store.uninstalled',
          entityType: 'store',
          entityId: store.id,
          correlationId,
        },
        tx,
      );
    });

    await revokeSessionsForStore(store.id);

    logger.info({ storeId: store.id }, 'Store uninstalled');
    return resultPage(
      'success',
      'The Kickflip Import app has been uninstalled. Your previously imported products were not deleted.',
      200,
    );
  } catch (error) {
    const appError = toAppError(error);
    logger.error(
      { code: appError.code, internalRef: appError.internalRef, err: appError.cause },
      'Uninstall callback failed',
    );
    return resultPage('error', appError.message, appError.httpStatus >= 500 ? 502 : 400);
  }
}
