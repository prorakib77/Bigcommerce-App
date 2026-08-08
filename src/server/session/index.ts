import { getEnv } from '@/server/env';
import { AppError } from '@/server/errors/app-error';
import { signSessionJwt, verifySessionJwt, SessionJwtError } from './jwt';
import {
  createSessionRecord,
  findActiveSession,
  revokeSession,
  revokeSessionsForStoreUser,
  revokeSessionsForStore,
} from './store';
import type { StoreUserRole } from '@prisma/client';

export interface SessionContext {
  sessionId: string;
  storeId: string;
  storeUserId: string;
  bigcommerceUserId: string;
  role: StoreUserRole;
}

export interface IssuedSession {
  token: string;
  expiresAt: Date;
}

/** Issues a new short-lived internal app session after a verified BC load callback. */
export async function issueAppSession(params: {
  storeId: string;
  storeUserId: string;
  bigcommerceUserId: string;
  role: StoreUserRole;
}): Promise<IssuedSession> {
  const ttlSeconds = getEnv().APP_SESSION_TTL_MINUTES * 60;
  const record = await createSessionRecord({
    storeId: params.storeId,
    storeUserId: params.storeUserId,
    ttlSeconds,
  });

  const token = await signSessionJwt(
    {
      sid: record.id,
      storeId: params.storeId,
      storeUserId: params.storeUserId,
      bigcommerceUserId: params.bigcommerceUserId,
      role: params.role,
      jti: record.jti,
    },
    ttlSeconds,
  );

  return { token, expiresAt: record.expiresAt };
}

/**
 * Verifies a bearer token end-to-end: signature/expiry, then the
 * server-side session record (allows revocation and reflects live
 * store/user active state). Throws AppError with a stable public code.
 */
export async function resolveSessionFromBearerToken(token: string): Promise<SessionContext> {
  let claims;
  try {
    claims = await verifySessionJwt(token);
  } catch (error) {
    if (error instanceof SessionJwtError && error.reason === 'expired') {
      throw new AppError('SESSION_EXPIRED', { cause: error });
    }
    throw new AppError('UNAUTHENTICATED', { cause: error });
  }

  const active = await findActiveSession(claims.sid, claims.jti);
  if (!active) {
    throw new AppError('SESSION_EXPIRED');
  }
  if (!active.storeIsActive) {
    throw new AppError('STORE_INACTIVE');
  }
  if (!active.storeUserIsActive) {
    throw new AppError('FORBIDDEN', { publicDetail: 'This user has been removed from the store.' });
  }
  // Defense in depth: the JWT claims and the live DB row must agree.
  if (active.storeId !== claims.storeId || active.storeUserId !== claims.storeUserId) {
    throw new AppError('UNAUTHENTICATED');
  }

  return {
    sessionId: active.id,
    storeId: active.storeId,
    storeUserId: active.storeUserId,
    bigcommerceUserId: active.bigcommerceUserId,
    role: active.role,
  };
}

export function extractBearerToken(authorizationHeader: string | null): string | null {
  if (!authorizationHeader) return null;
  const match = /^Bearer\s+(.+)$/i.exec(authorizationHeader.trim());
  return match?.[1]?.trim() || null;
}

export { revokeSession, revokeSessionsForStoreUser, revokeSessionsForStore };
