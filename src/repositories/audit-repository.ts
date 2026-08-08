import type { AuditLog, Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '@/server/db/prisma';
import { redactDeep } from '@/server/logging/redaction';

export interface RecordAuditEventInput {
  storeId: string;
  storeUserId?: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  metadata?: object;
  correlationId?: string | null;
  requestIdentifier?: string | null;
}

export async function recordAuditEvent(
  input: RecordAuditEventInput,
  client: Prisma.TransactionClient | PrismaClient = prisma,
): Promise<AuditLog> {
  return client.auditLog.create({
    data: {
      storeId: input.storeId,
      storeUserId: input.storeUserId ?? null,
      action: input.action,
      entityType: input.entityType,
      entityId: input.entityId ?? null,
      safeMetadata: input.metadata
        ? (redactDeep(input.metadata) as Prisma.InputJsonValue)
        : undefined,
      correlationId: input.correlationId ?? null,
      requestIdentifier: input.requestIdentifier ?? null,
    },
  });
}

export interface ListAuditLogsFilter {
  storeId: string;
  entityType?: string;
  entityId?: string;
  cursor?: string;
  limit: number;
}

export interface AuditLogsPage {
  items: AuditLog[];
  nextCursor: string | null;
}

export async function listAuditLogs(filter: ListAuditLogsFilter): Promise<AuditLogsPage> {
  const items = await prisma.auditLog.findMany({
    where: {
      storeId: filter.storeId,
      entityType: filter.entityType,
      entityId: filter.entityId,
    },
    orderBy: { createdAt: 'desc' },
    take: filter.limit + 1,
    ...(filter.cursor ? { cursor: { id: filter.cursor }, skip: 1 } : {}),
  });

  const hasMore = items.length > filter.limit;
  const page = hasMore ? items.slice(0, filter.limit) : items;
  return {
    items: page,
    nextCursor: hasMore ? (page[page.length - 1]?.id ?? null) : null,
  };
}

/** Deletes audit records older than the retention cutoff. Used by the retention job. */
export async function purgeAuditLogsOlderThan(cutoff: Date): Promise<number> {
  const result = await prisma.auditLog.deleteMany({ where: { createdAt: { lt: cutoff } } });
  return result.count;
}
