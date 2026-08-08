import type { ProductCustomizeConfig } from '@prisma/client';
import { prisma } from '@/server/db/prisma';

export async function findCustomizeConfig(
  storeId: string,
  bigcommerceProductId: number,
): Promise<ProductCustomizeConfig | null> {
  return prisma.productCustomizeConfig.findUnique({
    where: { storeId_bigcommerceProductId: { storeId, bigcommerceProductId } },
  });
}

/** Batch lookup for a page of product ids — avoids N+1 when listing products. */
export async function findCustomizeConfigsByProductIds(
  storeId: string,
  bigcommerceProductIds: number[],
): Promise<ProductCustomizeConfig[]> {
  if (bigcommerceProductIds.length === 0) return [];
  return prisma.productCustomizeConfig.findMany({
    where: { storeId, bigcommerceProductId: { in: bigcommerceProductIds } },
  });
}

export interface UpsertCustomizeConfigInput {
  storeId: string;
  bigcommerceProductId: number;
  enabled: boolean;
  customizeUrl: string | null;
  buttonLabel: string;
}

export async function upsertCustomizeConfig(
  input: UpsertCustomizeConfigInput,
): Promise<ProductCustomizeConfig> {
  return prisma.productCustomizeConfig.upsert({
    where: {
      storeId_bigcommerceProductId: {
        storeId: input.storeId,
        bigcommerceProductId: input.bigcommerceProductId,
      },
    },
    update: {
      enabled: input.enabled,
      customizeUrl: input.customizeUrl,
      buttonLabel: input.buttonLabel,
    },
    create: {
      storeId: input.storeId,
      bigcommerceProductId: input.bigcommerceProductId,
      enabled: input.enabled,
      customizeUrl: input.customizeUrl,
      buttonLabel: input.buttonLabel,
    },
  });
}
