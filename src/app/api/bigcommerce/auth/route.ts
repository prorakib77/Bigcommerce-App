import { getEnv } from '@/server/env';
import { getLogger } from '@/server/logging/logger';
import { resolveCorrelationId } from '@/server/logging/correlation';
import { encryptSecret } from '@/server/crypto/encryption';
import { prisma } from '@/server/db/prisma';
import { upsertStoreInstall } from '@/repositories/store-repository';
import { upsertStoreUser } from '@/repositories/user-repository';
import { recordAuditEvent } from '@/repositories/audit-repository';
import { authCallbackQuerySchema, storeHashFromContext } from '@/lib/bigcommerce/schemas';
import { exchangeAuthorizationCode, requiredScopesGranted } from '@/lib/bigcommerce/oauth';
import { htmlResponse, renderResultPage } from '@/lib/bigcommerce/html-templates';
import { AppError, toAppError } from '@/server/errors/app-error';
import { ensureStorefrontScriptRegistered } from '@/services/storefront-script-service';
import { ensureOrdersWebhookRegistered } from '@/services/orders-webhook-service';

export const dynamic = 'force-dynamic';

function errorPage(message: string, status: number): Response {
  return htmlResponse(
    renderResultPage({
      title: 'Installation failed',
      heading: 'We couldn’t finish installing the app',
      message,
      tone: 'error',
    }),
    status,
  );
}

export async function GET(request: Request): Promise<Response> {
  const correlationId = resolveCorrelationId(request.headers.get('x-request-id'));
  const logger = getLogger().child({ correlationId, route: 'bigcommerce.auth' });
  const env = getEnv();

  const url = new URL(request.url);
  const parsedQuery = authCallbackQuerySchema.safeParse(Object.fromEntries(url.searchParams));
  if (!parsedQuery.success) {
    logger.warn(
      { issues: parsedQuery.error.issues.map((i) => i.path.join('.')) },
      'Auth callback received invalid query parameters',
    );
    return errorPage(
      'The installation request from BigCommerce was missing required information.',
      400,
    );
  }
  const query = parsedQuery.data;

  if (!requiredScopesGranted(query.scope, env.BIGCOMMERCE_APP_SCOPES)) {
    logger.warn({ grantedScope: query.scope }, 'Auth callback scope mismatch');
    return errorPage(
      'The permissions granted during installation do not match what this app requires. Please reinstall and accept all requested permissions.',
      400,
    );
  }

  const contextStoreHash = storeHashFromContext(query.context);
  if (!contextStoreHash) {
    return errorPage('The store context from BigCommerce was invalid.', 400);
  }

  try {
    const tokenResponse = await exchangeAuthorizationCode({
      code: query.code,
      scope: query.scope,
      context: query.context,
    });

    const tokenStoreHash = storeHashFromContext(tokenResponse.context);
    if (tokenStoreHash !== contextStoreHash) {
      throw new AppError('BIGCOMMERCE_OAUTH_FAILED', {
        publicDetail: 'Store context mismatch during installation.',
      });
    }

    const encryptedAccessToken = encryptSecret(tokenResponse.access_token);

    const { store } = await prisma.$transaction(async (tx) => {
      const store = await upsertStoreInstall(
        {
          storeHash: contextStoreHash,
          accountUuid: tokenResponse.account_uuid ?? null,
          platformContext: tokenResponse.context,
          encryptedAccessToken,
          scope: tokenResponse.scope,
          ownerBigcommerceUserId: String(tokenResponse.user.id),
          ownerEmail: tokenResponse.user.email,
        },
        tx,
      );

      // The installing user is treated as the store owner. If a later load
      // callback's `owner` claim disagrees (e.g. a different staff member
      // is the actual owner of record), the load callback reconciles roles.
      const storeUser = await upsertStoreUser(
        {
          storeId: store.id,
          bigcommerceUserId: String(tokenResponse.user.id),
          email: tokenResponse.user.email,
          role: 'OWNER',
        },
        tx,
      );

      await recordAuditEvent(
        {
          storeId: store.id,
          storeUserId: storeUser.id,
          action: 'store.installed',
          entityType: 'store',
          entityId: store.id,
          metadata: { scope: tokenResponse.scope },
          correlationId,
        },
        tx,
      );

      return { store, storeUser };
    });

    logger.info({ storeId: store.id }, 'Store installation completed');

    // Best-effort, non-fatal: registers the storefront Customize-button
    // widget via BigCommerce Script Manager. Install is a synchronous,
    // user-facing, mid-onboarding flow — a transient BigCommerce hiccup here
    // must never block onboarding. If this fails, saving any product's
    // customize config later retries the same self-healing registration
    // (see src/services/product-customize-service.ts).
    try {
      await ensureStorefrontScriptRegistered(store, correlationId, logger);
    } catch (scriptError) {
      logger.warn(
        { err: scriptError, storeId: store.id },
        'Failed to register the storefront Customize widget script during install',
      );
    }

    // Same best-effort, non-fatal treatment for the Orders webhook — if this
    // fails, the "Sync now" button on the Orders page retries the same
    // self-healing registration (see src/services/order-service.ts).
    try {
      await ensureOrdersWebhookRegistered(store, correlationId, logger);
    } catch (webhookError) {
      logger.warn(
        { err: webhookError, storeId: store.id },
        'Failed to register the Orders webhook during install',
      );
    }

    return htmlResponse(
      renderResultPage({
        title: 'App installed',
        heading: 'Installation complete',
        message:
          'The Kickflip Import app was installed successfully. Return to your BigCommerce control panel and open the app from the Apps menu to get started.',
        tone: 'success',
      }),
    );
  } catch (error) {
    const appError = toAppError(error);
    logger.error(
      { code: appError.code, internalRef: appError.internalRef, err: appError.cause },
      'Auth callback failed',
    );
    return errorPage(appError.message, appError.httpStatus >= 500 ? 502 : 400);
  }
}
