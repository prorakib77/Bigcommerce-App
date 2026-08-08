import { SignJWT, jwtVerify, errors as joseErrors } from 'jose';
import { getEnv } from '@/server/env';
import type { StoreUserRole } from '@prisma/client';

const ISSUER = 'kickflip-import-app';
const AUDIENCE = 'kickflip-import-app-client';
const ALGORITHM = 'HS256';

export interface SessionClaims {
  /** AppSession row id */
  sid: string;
  storeId: string;
  storeUserId: string;
  bigcommerceUserId: string;
  role: StoreUserRole;
  /** Unique token id — matches the hashed value stored on the AppSession row. */
  jti: string;
}

function getSigningKey(): Uint8Array {
  return Buffer.from(getEnv().APP_SESSION_SIGNING_KEY, 'base64');
}

export async function signSessionJwt(
  claims: SessionClaims,
  expiresInSeconds: number,
): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({ ...claims })
    .setProtectedHeader({ alg: ALGORITHM, typ: 'JWT' })
    .setIssuer(ISSUER)
    .setAudience(AUDIENCE)
    .setIssuedAt(now)
    .setExpirationTime(now + expiresInSeconds)
    .setJti(claims.jti)
    .sign(getSigningKey());
}

export class SessionJwtError extends Error {
  constructor(
    message: string,
    public readonly reason: 'expired' | 'invalid',
  ) {
    super(message);
    this.name = 'SessionJwtError';
  }
}

export async function verifySessionJwt(token: string): Promise<SessionClaims> {
  try {
    const { payload } = await jwtVerify(token, getSigningKey(), {
      issuer: ISSUER,
      audience: AUDIENCE,
      algorithms: [ALGORITHM],
    });

    const { sid, storeId, storeUserId, bigcommerceUserId, role, jti } = payload as Record<
      string,
      unknown
    >;

    if (
      typeof sid !== 'string' ||
      typeof storeId !== 'string' ||
      typeof storeUserId !== 'string' ||
      typeof bigcommerceUserId !== 'string' ||
      typeof role !== 'string' ||
      typeof jti !== 'string'
    ) {
      throw new SessionJwtError('Session token payload missing required claims', 'invalid');
    }

    return {
      sid,
      storeId,
      storeUserId,
      bigcommerceUserId,
      role: role as StoreUserRole,
      jti,
    };
  } catch (error) {
    if (error instanceof joseErrors.JWTExpired) {
      throw new SessionJwtError('Session token expired', 'expired');
    }
    if (error instanceof SessionJwtError) {
      throw error;
    }
    throw new SessionJwtError('Session token is invalid', 'invalid');
  }
}
