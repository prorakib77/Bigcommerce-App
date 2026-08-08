import { z } from 'zod';
import { authedRoute, jsonOk } from '@/server/http/handler';
import { readJsonBody } from '@/server/http/body';
import { assertPermission, Permissions } from '@/server/authorization';
import { assertWithinRateLimit } from '@/server/rate-limit';
import { getEnv } from '@/server/env';
import { AppError } from '@/server/errors/app-error';
import { testKickflipCredentials } from '@/services/connection-service';

export const dynamic = 'force-dynamic';

const bodySchema = z.object({
  tenantId: z.string().min(1).max(200),
  apiToken: z.string().min(1).max(500),
});

export const POST = authedRoute(async (request, ctx) => {
  assertPermission(ctx.session, Permissions.MANAGE_CONNECTION_AND_SETTINGS);
  const env = getEnv();
  assertWithinRateLimit(
    `kickflip-connection-test:${ctx.session.storeId}`,
    env.RATE_LIMIT_SENSITIVE_WINDOW_MS,
    env.RATE_LIMIT_SENSITIVE_MAX,
  );

  const parsed = bodySchema.safeParse(await readJsonBody(request));
  if (!parsed.success) throw new AppError('VALIDATION_FAILED');

  const result = await testKickflipCredentials(
    parsed.data.tenantId,
    parsed.data.apiToken,
    ctx.logger,
  );
  return jsonOk({ ok: true, verifiedAt: result.verifiedAt.toISOString() }, ctx.requestId);
});
