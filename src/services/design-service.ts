import { randomUUID } from 'node:crypto';
import { createKickflipClient, type NormalizedKickflipDesign } from '@/lib/kickflip';
import { resolveKickflipCredentials } from './connection-service';
import { listMappingsByDesignIds } from '@/repositories/mapping-repository';
import type { ImportMapping } from '@prisma/client';
import type { AppLogger } from '@/server/logging/logger';

export interface DesignWithMappingStatus {
  design: NormalizedKickflipDesign;
  mapping: {
    status: 'NONE' | 'UP_TO_DATE' | 'CHANGED' | 'ORPHANED';
    bigcommerceProductId: number | null;
    lastSuccessfulImportAt: string | null;
  };
}

function classifyMapping(
  design: NormalizedKickflipDesign,
  mapping: ImportMapping | undefined,
): DesignWithMappingStatus['mapping'] {
  if (!mapping) {
    return { status: 'NONE', bigcommerceProductId: null, lastSuccessfulImportAt: null };
  }
  if (mapping.status === 'ORPHANED') {
    return {
      status: 'ORPHANED',
      bigcommerceProductId: mapping.bigcommerceProductId,
      lastSuccessfulImportAt: mapping.lastSuccessfulImportAt?.toISOString() ?? null,
    };
  }
  return {
    status: mapping.sourceFingerprint === design.rawFingerprint ? 'UP_TO_DATE' : 'CHANGED',
    bigcommerceProductId: mapping.bigcommerceProductId,
    lastSuccessfulImportAt: mapping.lastSuccessfulImportAt?.toISOString() ?? null,
  };
}

export interface ListDesignsResult {
  items: DesignWithMappingStatus[];
  nextCursor: string | null;
  skippedCount: number;
}

export async function listDesignsWithMappingStatus(
  storeId: string,
  params: { cursor: string | null; limit: number },
  logger?: AppLogger,
): Promise<ListDesignsResult> {
  const credentials = await resolveKickflipCredentials(storeId);
  const client = createKickflipClient(credentials, { logger });

  const { page, skippedCount } = await client.listDesigns({
    cursor: params.cursor,
    limit: params.limit,
    correlationId: randomUUID(),
  });

  const mappings = await listMappingsByDesignIds(
    storeId,
    page.items.map((d) => d.externalId),
  );
  const mappingByDesignId = new Map(mappings.map((m) => [m.kickflipDesignId, m]));

  return {
    items: page.items.map((design) => ({
      design,
      mapping: classifyMapping(design, mappingByDesignId.get(design.externalId)),
    })),
    nextCursor: page.nextCursor,
    skippedCount,
  };
}

export async function getDesignWithMappingStatus(
  storeId: string,
  designId: string,
  logger?: AppLogger,
): Promise<DesignWithMappingStatus> {
  const credentials = await resolveKickflipCredentials(storeId);
  const client = createKickflipClient(credentials, { logger });
  const design = await client.getDesign(designId, randomUUID());
  const [mapping] = await listMappingsByDesignIds(storeId, [designId]);
  return { design, mapping: classifyMapping(design, mapping) };
}
