import { randomUUID } from 'node:crypto';
import { encryptSecret, decryptSecret } from '@/server/crypto/encryption';
import { AppError } from '@/server/errors/app-error';
import { createKickflipClient } from '@/lib/kickflip';
import {
  findKickflipConnection,
  saveKickflipConnection,
  recordKickflipConnectionError,
  disconnectKickflipConnection as disconnectKickflipConnectionRepo,
} from '@/repositories/connection-repository';
import { recordAuditEvent } from '@/repositories/audit-repository';
import type { AppLogger } from '@/server/logging/logger';

export interface ConnectionView {
  status: 'NOT_CONFIGURED' | 'CONNECTED' | 'ERROR' | 'DISCONNECTED';
  tenantId: string | null;
  maskedToken: string | null;
  lastVerifiedAt: string | null;
  lastErrorCode: string | null;
}

export async function getConnectionView(storeId: string): Promise<ConnectionView> {
  const connection = await findKickflipConnection(storeId);
  if (!connection) {
    return {
      status: 'NOT_CONFIGURED',
      tenantId: null,
      maskedToken: null,
      lastVerifiedAt: null,
      lastErrorCode: null,
    };
  }
  return {
    status: connection.status,
    tenantId: connection.tenantId,
    maskedToken: connection.tokenLastFour ? `••••••••${connection.tokenLastFour}` : null,
    lastVerifiedAt: connection.lastVerifiedAt?.toISOString() ?? null,
    lastErrorCode: connection.lastErrorCode,
  };
}

export async function testKickflipCredentials(
  tenantId: string,
  apiToken: string,
  logger?: AppLogger,
): Promise<{ verifiedAt: Date }> {
  const client = createKickflipClient({ tenantId, apiToken }, { logger });
  const result = await client.testConnection(randomUUID());
  return { verifiedAt: result.verifiedAt };
}

export interface SaveConnectionInput {
  storeId: string;
  storeUserId: string;
  tenantId: string;
  apiToken: string;
  correlationId: string;
}

/** Tests, encrypts, and transactionally saves a new/rotated Kickflip credential. */
export async function saveKickflipCredentials(input: SaveConnectionInput): Promise<ConnectionView> {
  let verifiedAt: Date;
  try {
    const result = await testKickflipCredentials(input.tenantId, input.apiToken);
    verifiedAt = result.verifiedAt;
  } catch (error) {
    await recordKickflipConnectionError(
      input.storeId,
      error instanceof AppError ? error.code : 'KICKFLIP_API_UNAVAILABLE',
    );
    throw error;
  }

  const encryptedApiToken = encryptSecret(input.apiToken);
  const tokenLastFour = input.apiToken.slice(-4);

  await saveKickflipConnection({
    storeId: input.storeId,
    tenantId: input.tenantId,
    encryptedApiToken,
    tokenLastFour,
    status: 'CONNECTED',
    lastVerifiedAt: verifiedAt,
  });

  await recordAuditEvent({
    storeId: input.storeId,
    storeUserId: input.storeUserId,
    action: 'kickflip_connection.saved',
    entityType: 'kickflip_connection',
    metadata: { tenantId: input.tenantId },
    correlationId: input.correlationId,
  });

  return getConnectionView(input.storeId);
}

export async function disconnectKickflip(
  storeId: string,
  storeUserId: string,
  correlationId: string,
): Promise<void> {
  await disconnectKickflipConnectionRepo(storeId);
  await recordAuditEvent({
    storeId,
    storeUserId,
    action: 'kickflip_connection.disconnected',
    entityType: 'kickflip_connection',
    correlationId,
  });
}

/** Resolves and decrypts the active Kickflip credentials for a store. Throws if not configured. */
export async function resolveKickflipCredentials(
  storeId: string,
): Promise<{ tenantId: string; apiToken: string }> {
  const connection = await findKickflipConnection(storeId);
  if (!connection || connection.status !== 'CONNECTED' || !connection.encryptedApiToken) {
    throw new AppError('KICKFLIP_NOT_CONFIGURED');
  }
  return { tenantId: connection.tenantId, apiToken: decryptSecret(connection.encryptedApiToken) };
}
