import { z } from 'zod';
import { authedRoute, jsonOk } from '@/server/http/handler';
import { readJsonBody } from '@/server/http/body';
import { assertPermission, Permissions } from '@/server/authorization';
import { assertWithinRateLimit } from '@/server/rate-limit';
import { getEnv } from '@/server/env';
import { AppError } from '@/server/errors/app-error';
import {
  getConnectionView,
  saveKickflipCredentials,
  disconnectKickflip,
} from '@/services/connection-service';

export const dynamic = 'force-dynamic';

export const GET = authedRoute(async (_request, ctx) => {
  assertPermission(ctx.session, Permissions.VIEW);
  const view = await getConnectionView(ctx.session.storeId);
  return jsonOk(view, ctx.requestId);
});

const putBodySchema = z.object({
  tenantId: z.string().min(1).max(200),
  apiToken: z.string().min(1).max(500),
});

export const PUT = authedRoute(async (request, ctx) => {
  assertPermission(ctx.session, Permissions.MANAGE_CONNECTION_AND_SETTINGS);
  const env = getEnv();
  assertWithinRateLimit(
    `kickflip-connection-write:${ctx.session.storeId}`,
    env.RATE_LIMIT_SENSITIVE_WINDOW_MS,
    env.RATE_LIMIT_SENSITIVE_MAX,
  );

  const parsed = putBodySchema.safeParse(await readJsonBody(request));
  if (!parsed.success) throw new AppError('VALIDATION_FAILED');

  const view = await saveKickflipCredentials({
    storeId: ctx.session.storeId,
    storeUserId: ctx.session.storeUserId,
    tenantId: parsed.data.tenantId,
    apiToken: parsed.data.apiToken,
    correlationId: ctx.correlationId,
  });

  return jsonOk(view, ctx.requestId);
});

export const DELETE = authedRoute(async (_request, ctx) => {
  assertPermission(ctx.session, Permissions.MANAGE_CONNECTION_AND_SETTINGS);
  await disconnectKickflip(ctx.session.storeId, ctx.session.storeUserId, ctx.correlationId);
  return jsonOk({ disconnected: true }, ctx.requestId);
});
