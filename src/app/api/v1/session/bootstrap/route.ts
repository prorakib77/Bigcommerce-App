import { z } from 'zod';
import { publicRoute, jsonOk } from '@/server/http/handler';
import { readJsonBody } from '@/server/http/body';
import { assertWithinRateLimit } from '@/server/rate-limit';
import { getEnv } from '@/server/env';
import { AppError } from '@/server/errors/app-error';
import { consumeBootstrapCode } from '@/server/session/bootstrap';
import { issueAppSession } from '@/server/session';
import { findStoreById } from '@/repositories/store-repository';
import { findStoreUserById } from '@/repositories/user-repository';

const bodySchema = z.object({ code: z.string().min(1).max(256) });

export const dynamic = 'force-dynamic';

export const POST = publicRoute(async (request, ctx) => {
  const env = getEnv();
  assertWithinRateLimit(
    `session-bootstrap:${ctx.clientIp}`,
    env.RATE_LIMIT_SENSITIVE_WINDOW_MS,
    env.RATE_LIMIT_SENSITIVE_MAX,
  );

  const body = bodySchema.safeParse(await readJsonBody(request));
  if (!body.success) {
    throw new AppError('VALIDATION_FAILED');
  }

  const { storeId, storeUserId } = await consumeBootstrapCode(body.data.code);

  const [store, storeUser] = await Promise.all([
    findStoreById(storeId),
    findStoreUserById(storeUserId),
  ]);

  if (!store || !store.isActive) {
    throw new AppError('STORE_INACTIVE');
  }
  if (!storeUser || !storeUser.isActive) {
    throw new AppError('FORBIDDEN', { publicDetail: 'This user no longer has access.' });
  }

  const session = await issueAppSession({
    storeId: store.id,
    storeUserId: storeUser.id,
    bigcommerceUserId: storeUser.bigcommerceUserId,
    role: storeUser.role,
  });

  ctx.logger.info(
    { storeId: store.id, storeUserId: storeUser.id },
    'Issued app session via bootstrap',
  );

  return jsonOk(
    {
      token: session.token,
      expiresAt: session.expiresAt.toISOString(),
      role: storeUser.role,
      email: storeUser.email,
    },
    ctx.requestId,
  );
});
