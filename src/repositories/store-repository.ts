import type { Prisma, PrismaClient, Store } from '@prisma/client';
import { prisma } from '@/server/db/prisma';

export interface UpsertStoreInstallInput {
  storeHash: string;
  accountUuid: string | null;
  platformContext: string | null;
  encryptedAccessToken: string;
  scope: string;
  ownerBigcommerceUserId: string;
  ownerEmail: string;
}

/**
 * Creates a store on first install, or reactivates + refreshes token/scope
 * on a repeat install (uninstall followed by reinstall, or a scope change).
 * Runs inside the caller's transaction when one is supplied so it composes
 * with the owner StoreUser upsert atomically.
 */
export async function upsertStoreInstall(
  input: UpsertStoreInstallInput,
  client: Prisma.TransactionClient | PrismaClient = prisma,
): Promise<Store> {
  return client.store.upsert({
    where: { storeHash: input.storeHash },
    update: {
      accountUuid: input.accountUuid,
      platformContext: input.platformContext,
      encryptedAccessToken: input.encryptedAccessToken,
      scope: input.scope,
      ownerBigcommerceUserId: input.ownerBigcommerceUserId,
      ownerEmail: input.ownerEmail,
      isActive: true,
      uninstalledAt: null,
    },
    create: {
      storeHash: input.storeHash,
      accountUuid: input.accountUuid,
      platformContext: input.platformContext,
      encryptedAccessToken: input.encryptedAccessToken,
      scope: input.scope,
      ownerBigcommerceUserId: input.ownerBigcommerceUserId,
      ownerEmail: input.ownerEmail,
      isActive: true,
    },
  });
}

export async function findStoreByHash(storeHash: string): Promise<Store | null> {
  return prisma.store.findUnique({ where: { storeHash } });
}

export async function findStoreById(storeId: string): Promise<Store | null> {
  return prisma.store.findUnique({ where: { id: storeId } });
}

export async function markStoreUninstalled(
  storeHash: string,
  client: Prisma.TransactionClient | PrismaClient = prisma,
): Promise<Store> {
  return client.store.update({
    where: { storeHash },
    data: { isActive: false, uninstalledAt: new Date() },
  });
}

/**
 * Records that the storefront Customize-widget script was successfully
 * registered with BigCommerce Script Manager — see
 * src/services/storefront-script-service.ts. `updateMany` (not `update`) so
 * this is a safe no-op rather than a throw if the store row is somehow gone
 * by the time this resolves, matching this codebase's existing convention
 * for state-only writes (see connection-repository.ts).
 */
export async function updateStorefrontScriptRegistration(
  storeId: string,
  uuid: string,
): Promise<void> {
  await prisma.store.updateMany({
    where: { id: storeId },
    data: { storefrontScriptUuid: uuid, storefrontScriptRegisteredAt: new Date() },
  });
}

/**
 * Records that the Orders webhook was registered with BigCommerce — see
 * src/services/orders-webhook-service.ts. Same `updateMany` no-throw-if-missing
 * convention as updateStorefrontScriptRegistration above.
 */
export async function updateOrdersWebhookRegistration(
  storeId: string,
  input: { webhookId: number; secret: string },
): Promise<void> {
  await prisma.store.updateMany({
    where: { id: storeId },
    data: {
      ordersWebhookId: input.webhookId,
      ordersWebhookSecret: input.secret,
      ordersWebhookRegisteredAt: new Date(),
    },
  });
}

export interface StoreDashboardCounts {
  storeId: string;
  isActive: boolean;
  kickflipConnected: boolean;
  bigcommerceConnected: boolean;
  importedProductCount: number;
  succeededCount: number;
  partialCount: number;
  failedCount: number;
}

export async function getStoreDashboardCounts(storeId: string): Promise<StoreDashboardCounts> {
  const [store, connection, importedProductCount, succeededCount, partialCount, failedCount] =
    await prisma.$transaction([
      prisma.store.findUniqueOrThrow({ where: { id: storeId } }),
      prisma.kickflipConnection.findUnique({ where: { storeId } }),
      prisma.importMapping.count({ where: { storeId, status: 'ACTIVE' } }),
      prisma.importRun.count({ where: { storeId, status: 'SUCCEEDED' } }),
      prisma.importRun.count({ where: { storeId, status: 'PARTIAL' } }),
      prisma.importRun.count({ where: { storeId, status: 'FAILED' } }),
    ]);

  return {
    storeId,
    isActive: store.isActive,
    kickflipConnected: connection?.status === 'CONNECTED',
    bigcommerceConnected: Boolean(store.encryptedAccessToken) && store.isActive,
    importedProductCount,
    succeededCount,
    partialCount,
    failedCount,
  };
}
