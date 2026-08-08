import { randomUUID } from 'node:crypto';
import { prisma } from '@/server/db/prisma';
import { sha256Hex } from '@/server/crypto/hash';
import type { StoreUserRole } from '@prisma/client';

export interface CreateSessionInput {
  storeId: string;
  storeUserId: string;
  ttlSeconds: number;
}

export interface PersistedSession {
  id: string;
  jti: string;
  expiresAt: Date;
}

export async function createSessionRecord(input: CreateSessionInput): Promise<PersistedSession> {
  const jti = randomUUID();
  const expiresAt = new Date(Date.now() + input.ttlSeconds * 1000);

  const record = await prisma.appSession.create({
    data: {
      storeId: input.storeId,
      storeUserId: input.storeUserId,
      hashedTokenId: sha256Hex(jti),
      expiresAt,
    },
    select: { id: true },
  });

  return { id: record.id, jti, expiresAt };
}

export interface ActiveSessionRecord {
  id: string;
  storeId: string;
  storeUserId: string;
  bigcommerceUserId: string;
  role: StoreUserRole;
  storeIsActive: boolean;
  storeUserIsActive: boolean;
}

/**
 * Loads the session row plus enough store/user state to make an
 * authorization decision, in one round trip. Returns null if the session
 * doesn't exist, was revoked, expired, or the token-id hash doesn't match
 * (defense in depth against a forged `sid`/`jti` pairing).
 */
export async function findActiveSession(
  sessionId: string,
  jti: string,
): Promise<ActiveSessionRecord | null> {
  const record = await prisma.appSession.findUnique({
    where: { id: sessionId },
    include: {
      store: { select: { id: true, isActive: true } },
      storeUser: {
        select: { id: true, bigcommerceUserId: true, role: true, isActive: true },
      },
    },
  });

  if (!record) return null;
  if (record.revokedAt) return null;
  if (record.expiresAt.getTime() <= Date.now()) return null;
  if (record.hashedTokenId !== sha256Hex(jti)) return null;

  return {
    id: record.id,
    storeId: record.store.id,
    storeUserId: record.storeUser.id,
    bigcommerceUserId: record.storeUser.bigcommerceUserId,
    role: record.storeUser.role,
    storeIsActive: record.store.isActive,
    storeUserIsActive: record.storeUser.isActive,
  };
}

export async function revokeSession(sessionId: string): Promise<void> {
  await prisma.appSession.updateMany({
    where: { id: sessionId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function revokeSessionsForStoreUser(storeUserId: string): Promise<void> {
  await prisma.appSession.updateMany({
    where: { storeUserId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}

export async function revokeSessionsForStore(storeId: string): Promise<void> {
  await prisma.appSession.updateMany({
    where: { storeId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
}
