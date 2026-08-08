import { getLogger } from '@/server/logging/logger';
import { resolveCorrelationId } from '@/server/logging/correlation';
import { AppError, toAppError } from '@/server/errors/app-error';
import {
  extractBearerToken,
  resolveSessionFromBearerToken,
  type SessionContext,
} from '@/server/session';
import { getClientIp } from './client-ip';
import { jsonError, jsonOk } from './response';

export interface RouteContext {
  correlationId: string;
  requestId: string;
  clientIp: string;
  logger: ReturnType<typeof getLogger>;
  params: Record<string, string>;
}

/** Next.js App Router's second route-handler argument; `params` is a Promise as of Next 15+. */
export interface NextRouteParams {
  params: Promise<Record<string, string>>;
}

type Handler = (request: Request, ctx: RouteContext) => Promise<Response>;
type AuthedHandler = (
  request: Request,
  ctx: RouteContext & { session: SessionContext },
) => Promise<Response>;

async function buildContext(
  request: Request,
  routeParams?: NextRouteParams,
): Promise<RouteContext> {
  const correlationId = resolveCorrelationId(request.headers.get('x-request-id'));
  const params = routeParams ? await routeParams.params : {};
  return {
    correlationId,
    requestId: correlationId,
    clientIp: getClientIp(request),
    logger: getLogger().child({ correlationId, route: new URL(request.url).pathname }),
    params,
  };
}

/** Wraps a public (unauthenticated) route handler with correlation IDs and centralized error mapping. */
export function publicRoute(handler: Handler) {
  return async (request: Request, routeParams?: NextRouteParams): Promise<Response> => {
    const ctx = await buildContext(request, routeParams);
    try {
      return await handler(request, ctx);
    } catch (error) {
      const appError = toAppError(error);
      ctx.logger.error(
        { code: appError.code, internalRef: appError.internalRef, err: appError.cause },
        appError.message,
      );
      return jsonError(appError, ctx.requestId);
    }
  };
}

/**
 * Wraps a route handler that requires a valid internal app session. Resolves
 * the bearer token, verifies it server-side (signature + live DB state), and
 * hands the caller a typed `session` alongside the usual route context
 * (including resolved dynamic-segment `params`, e.g. `[importId]`).
 */
export function authedRoute(handler: AuthedHandler) {
  return async (request: Request, routeParams?: NextRouteParams): Promise<Response> => {
    const ctx = await buildContext(request, routeParams);
    try {
      const token = extractBearerToken(request.headers.get('authorization'));
      if (!token) {
        throw new AppError('UNAUTHENTICATED');
      }
      const session = await resolveSessionFromBearerToken(token);
      const scopedLogger = ctx.logger.child({
        storeId: session.storeId,
        storeUserId: session.storeUserId,
      });
      return await handler(request, { ...ctx, logger: scopedLogger, session });
    } catch (error) {
      const appError = toAppError(error);
      ctx.logger.error(
        { code: appError.code, internalRef: appError.internalRef, err: appError.cause },
        appError.message,
      );
      return jsonError(appError, ctx.requestId);
    }
  };
}

export { jsonOk, jsonError };
