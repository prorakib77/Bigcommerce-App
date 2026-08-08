import { randomUUID } from 'node:crypto';
import { prisma } from '@/server/db/prisma';
import { encryptSecret } from '@/server/crypto/encryption';
import type { Store, StoreUser } from '@prisma/client';

export interface SeededStore {
  store: Store;
  owner: StoreUser;
}

/** Seeds a fully-configured store (installed, owner, settings, mock-mode Kickflip connection). */
export async function seedStore(
  overrides: { storeHash?: string; importImages?: boolean } = {},
): Promise<SeededStore> {
  const storeHash = overrides.storeHash ?? `store-${randomUUID().slice(0, 8)}`;

  const store = await prisma.store.create({
    data: {
      storeHash,
      encryptedAccessToken: encryptSecret('fake-bc-access-token'),
      scope: 'store_v2_products',
      ownerBigcommerceUserId: '1000',
      ownerEmail: 'owner@example.com',
      isActive: true,
    },
  });

  const owner = await prisma.storeUser.create({
    data: {
      storeId: store.id,
      bigcommerceUserId: '1000',
      email: 'owner@example.com',
      role: 'OWNER',
      isActive: true,
    },
  });

  await prisma.storeSettings.create({
    data: {
      storeId: store.id,
      defaultCategoryIds: [],
      defaultProductWeight: 0.5,
      skuPrefix: 'KF',
      defaultVisibility: false,
      importImages: overrides.importImages ?? false,
      updateImagesOnReimport: true,
      updateNameOnReimport: true,
      updatePriceOnReimport: true,
      updateDescriptionOnReimport: true,
      maxImagesPerDesign: 8,
    },
  });

  await prisma.kickflipConnection.create({
    data: {
      storeId: store.id,
      tenantId: 'mock-tenant',
      encryptedApiToken: encryptSecret('fake-kickflip-token'),
      tokenLastFour: 'oken',
      status: 'CONNECTED',
      lastVerifiedAt: new Date(),
    },
  });

  return { store, owner };
}
