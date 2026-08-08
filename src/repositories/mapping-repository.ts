import type { ImportMapping, Prisma, PrismaClient } from '@prisma/client';
import { prisma } from '@/server/db/prisma';

export async function findMappingByDesign(
  storeId: string,
  kickflipDesignId: string,
): Promise<ImportMapping | null> {
  return prisma.importMapping.findUnique({
    where: { storeId_kickflipDesignId: { storeId, kickflipDesignId } },
  });
}

export async function findMappingByBigcommerceProduct(
  storeId: string,
  bigcommerceProductId: number,
): Promise<ImportMapping | null> {
  return prisma.importMapping.findUnique({
    where: { storeId_bigcommerceProductId: { storeId, bigcommerceProductId } },
  });
}

export async function findMappingById(mappingId: string): Promise<ImportMapping | null> {
  return prisma.importMapping.findUnique({ where: { id: mappingId } });
}

export interface CreateMappingInput {
  storeId: string;
  kickflipDesignId: string;
  kickflipNumericDesignId: number | null;
  kickflipProductId: string | null;
  kickflipCustomizerProductId: string | null;
  bigcommerceProductId: number;
  sourceFingerprint: string;
  sourceUpdatedAt: Date | null;
}

/**
 * Creates the canonical duplicate-prevention record for a newly-created
 * BigCommerce product. Relies on the DB-level unique constraint on
 * (storeId, kickflipDesignId) as the final word on "does a mapping already
 * exist" — callers should still check first for a fast path, but must not
 * assume that check is race-free without this constraint backing it up.
 */
export async function createMapping(
  input: CreateMappingInput,
  client: Prisma.TransactionClient | PrismaClient = prisma,
): Promise<ImportMapping> {
  const now = new Date();
  return client.importMapping.create({
    data: {
      storeId: input.storeId,
      kickflipDesignId: input.kickflipDesignId,
      kickflipNumericDesignId: input.kickflipNumericDesignId,
      kickflipProductId: input.kickflipProductId,
      kickflipCustomizerProductId: input.kickflipCustomizerProductId,
      bigcommerceProductId: input.bigcommerceProductId,
      sourceFingerprint: input.sourceFingerprint,
      sourceUpdatedAt: input.sourceUpdatedAt,
      status: 'ACTIVE',
      lastSuccessfulImportAt: now,
      lastAttemptedImportAt: now,
      orphaned: false,
    },
  });
}

export interface UpdateMappingAfterImportInput {
  sourceFingerprint: string;
  sourceUpdatedAt: Date | null;
  successful: boolean;
  /** Set when recreating a product for a previously-orphaned mapping. */
  bigcommerceProductId?: number;
}

export async function updateMappingAfterImport(
  mappingId: string,
  input: UpdateMappingAfterImportInput,
  client: Prisma.TransactionClient | PrismaClient = prisma,
): Promise<ImportMapping> {
  const now = new Date();
  return client.importMapping.update({
    where: { id: mappingId },
    data: {
      sourceFingerprint: input.sourceFingerprint,
      sourceUpdatedAt: input.sourceUpdatedAt,
      lastAttemptedImportAt: now,
      lastSuccessfulImportAt: input.successful ? now : undefined,
      status: 'ACTIVE',
      orphaned: false,
      bigcommerceProductId: input.bigcommerceProductId,
    },
  });
}

export async function touchMappingAttempt(mappingId: string): Promise<void> {
  await prisma.importMapping.update({
    where: { id: mappingId },
    data: { lastAttemptedImportAt: new Date() },
  });
}

export async function markMappingOrphaned(mappingId: string): Promise<void> {
  await prisma.importMapping.update({
    where: { id: mappingId },
    data: { status: 'ORPHANED', orphaned: true },
  });
}

export interface ListMappingsPage {
  items: ImportMapping[];
  nextCursor: string | null;
}

export async function listMappingsByDesignIds(
  storeId: string,
  kickflipDesignIds: string[],
): Promise<ImportMapping[]> {
  if (kickflipDesignIds.length === 0) return [];
  return prisma.importMapping.findMany({
    where: { storeId, kickflipDesignId: { in: kickflipDesignIds } },
  });
}
