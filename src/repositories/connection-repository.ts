import type { KickflipConnection, KickflipConnectionStatus } from '@prisma/client';
import { prisma } from '@/server/db/prisma';

export async function findKickflipConnection(storeId: string): Promise<KickflipConnection | null> {
  return prisma.kickflipConnection.findUnique({ where: { storeId } });
}

export interface SaveKickflipConnectionInput {
  storeId: string;
  tenantId: string;
  encryptedApiToken: string;
  tokenLastFour: string;
  status: KickflipConnectionStatus;
  lastVerifiedAt: Date;
}

export async function saveKickflipConnection(
  input: SaveKickflipConnectionInput,
): Promise<KickflipConnection> {
  return prisma.kickflipConnection.upsert({
    where: { storeId: input.storeId },
    update: {
      tenantId: input.tenantId,
      encryptedApiToken: input.encryptedApiToken,
      tokenLastFour: input.tokenLastFour,
      status: input.status,
      lastVerifiedAt: input.lastVerifiedAt,
      lastErrorCode: null,
      disconnectedAt: null,
    },
    create: {
      storeId: input.storeId,
      tenantId: input.tenantId,
      encryptedApiToken: input.encryptedApiToken,
      tokenLastFour: input.tokenLastFour,
      status: input.status,
      lastVerifiedAt: input.lastVerifiedAt,
    },
  });
}

export async function recordKickflipConnectionError(
  storeId: string,
  errorCode: string,
): Promise<void> {
  await prisma.kickflipConnection.updateMany({
    where: { storeId },
    data: { status: 'ERROR', lastErrorCode: errorCode },
  });
}

export async function disconnectKickflipConnection(storeId: string): Promise<void> {
  await prisma.kickflipConnection.updateMany({
    where: { storeId },
    data: {
      encryptedApiToken: null,
      tokenLastFour: null,
      status: 'DISCONNECTED',
      disconnectedAt: new Date(),
    },
  });
}
