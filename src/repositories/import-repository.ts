import type {
  ImportOperation,
  ImportRun,
  ImportStatus,
  Prisma,
  PrismaClient,
} from '@prisma/client';
import { prisma } from '@/server/db/prisma';

export interface CreateImportRunInput {
  storeId: string;
  storeUserId: string;
  mappingId: string | null;
  kickflipDesignId: string;
  operation: ImportOperation;
  idempotencyKey: string;
  /** Any JSON-serializable object — callers shouldn't need to depend on Prisma's JSON input types. */
  optionsSnapshot: object;
  correlationId: string;
}

export async function createImportRun(
  input: CreateImportRunInput,
  client: Prisma.TransactionClient | PrismaClient = prisma,
): Promise<ImportRun> {
  return client.importRun.create({
    data: {
      storeId: input.storeId,
      storeUserId: input.storeUserId,
      mappingId: input.mappingId,
      kickflipDesignId: input.kickflipDesignId,
      operation: input.operation,
      status: 'QUEUED',
      idempotencyKey: input.idempotencyKey,
      optionsSnapshot: input.optionsSnapshot as Prisma.InputJsonValue,
      attemptCount: 0,
      correlationId: input.correlationId,
    },
  });
}

export async function findImportRunByIdempotencyKey(
  idempotencyKey: string,
): Promise<ImportRun | null> {
  return prisma.importRun.findUnique({ where: { idempotencyKey } });
}

export async function findImportRunById(id: string): Promise<ImportRun | null> {
  return prisma.importRun.findUnique({ where: { id } });
}

export interface TransitionImportRunInput {
  status: ImportStatus;
  currentStage?: string | null;
  bigcommerceProductId?: number | null;
  sourceFingerprint?: string | null;
  safeErrorCode?: string | null;
  safeErrorMessage?: string | null;
  internalErrorRef?: string | null;
  startedAt?: Date;
  finishedAt?: Date;
  incrementAttempt?: boolean;
}

export async function transitionImportRun(
  id: string,
  input: TransitionImportRunInput,
): Promise<ImportRun> {
  return prisma.importRun.update({
    where: { id },
    data: {
      status: input.status,
      currentStage: input.currentStage,
      bigcommerceProductId: input.bigcommerceProductId,
      sourceFingerprint: input.sourceFingerprint ?? undefined,
      safeErrorCode: input.safeErrorCode,
      safeErrorMessage: input.safeErrorMessage,
      internalErrorRef: input.internalErrorRef,
      startedAt: input.startedAt,
      finishedAt: input.finishedAt,
      attemptCount: input.incrementAttempt ? { increment: 1 } : undefined,
    },
  });
}

export interface ListImportRunsFilter {
  storeId: string;
  status?: ImportStatus[];
  kickflipDesignId?: string;
  bigcommerceProductId?: number;
  createdAfter?: Date;
  createdBefore?: Date;
  cursor?: string;
  limit: number;
}

export interface ImportRunsPage {
  items: ImportRun[];
  nextCursor: string | null;
}

export async function listImportRuns(filter: ListImportRunsFilter): Promise<ImportRunsPage> {
  const where: Prisma.ImportRunWhereInput = {
    storeId: filter.storeId,
    status: filter.status && filter.status.length > 0 ? { in: filter.status } : undefined,
    kickflipDesignId: filter.kickflipDesignId,
    bigcommerceProductId: filter.bigcommerceProductId,
    createdAt: {
      gte: filter.createdAfter,
      lte: filter.createdBefore,
    },
  };

  const items = await prisma.importRun.findMany({
    where,
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

const CANCELLABLE_STATUSES: ImportStatus[] = ['QUEUED'];

export async function cancelQueuedImportRun(id: string): Promise<ImportRun | null> {
  const result = await prisma.importRun.updateMany({
    where: { id, status: { in: CANCELLABLE_STATUSES } },
    data: { status: 'CANCELLED', finishedAt: new Date() },
  });
  if (result.count === 0) return null;
  return findImportRunById(id);
}

const ACTIVE_STATUSES: ImportStatus[] = [
  'QUEUED',
  'FETCHING_SOURCE',
  'VALIDATING_SOURCE',
  'CREATING_PRODUCT',
  'UPDATING_PRODUCT',
  'PROCESSING_IMAGES',
  'WRITING_METADATA',
  'FINALIZING',
];

export async function findActiveImportRunForDesign(
  storeId: string,
  kickflipDesignId: string,
): Promise<ImportRun | null> {
  return prisma.importRun.findFirst({
    where: { storeId, kickflipDesignId, status: { in: ACTIVE_STATUSES } },
    orderBy: { createdAt: 'desc' },
  });
}
