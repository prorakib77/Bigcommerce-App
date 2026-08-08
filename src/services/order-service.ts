import type { Store } from '@prisma/client';
import { AppError } from '@/server/errors/app-error';
import { decryptSecret } from '@/server/crypto/encryption';
import type { AppLogger } from '@/server/logging/logger';
import { createOrdersService } from '@/lib/bigcommerce/orders-service';
import type { BcOrder } from '@/lib/bigcommerce/schemas';
import { findStoreByHash, findStoreById } from '@/repositories/store-repository';
import {
  upsertOrder,
  listOrdersForStore as listOrdersForStoreRepo,
  type UpsertOrderInput,
  type OrdersPage,
} from '@/repositories/order-repository';
import { ensureOrdersWebhookRegistered } from './orders-webhook-service';

function mapBcOrderToUpsertInput(storeId: string, order: BcOrder): UpsertOrderInput {
  const firstName = order.billing_address?.first_name?.trim() ?? '';
  const lastName = order.billing_address?.last_name?.trim() ?? '';
  const customerName = [firstName, lastName].filter(Boolean).join(' ') || null;
  const createdAt = order.date_created ? new Date(order.date_created) : null;

  return {
    storeId,
    bigcommerceOrderId: order.id,
    status: order.status,
    statusId: order.status_id ?? null,
    customerName,
    customerEmail: order.billing_address?.email ?? null,
    totalIncTax: order.total_inc_tax,
    currencyCode: order.currency_code ?? null,
    itemCount: order.items_total ?? 0,
    orderCreatedAt: createdAt && !Number.isNaN(createdAt.getTime()) ? createdAt : null,
  };
}

async function requireOrdersService(store: Store, correlationId: string, logger?: AppLogger) {
  const accessToken = decryptSecret(store.encryptedAccessToken);
  return createOrdersService({ storeHash: store.storeHash, accessToken, correlationId, logger });
}

/**
 * Called by the public webhook receiver. Never trusts the webhook payload
 * as authoritative — always re-fetches the order from BigCommerce's own API
 * before writing anything, so a forged webhook (if a secret ever leaked)
 * can only trigger a redundant re-fetch of real, already-existing order
 * data, never fabricate a fake one.
 */
export async function syncOrderFromWebhook(
  storeHash: string,
  bigcommerceOrderId: number,
  correlationId: string,
  logger?: AppLogger,
): Promise<void> {
  const store = await findStoreByHash(storeHash);
  if (!store || !store.isActive) return;

  const ordersService = await requireOrdersService(store, correlationId, logger);
  const order = await ordersService.getOrder(bigcommerceOrderId);
  if (!order) {
    logger?.warn(
      { storeId: store.id, bigcommerceOrderId },
      'Order referenced by webhook was not found in BigCommerce',
    );
    return;
  }

  await upsertOrder(mapBcOrderToUpsertInput(store.id, order));
}

export interface ListOrdersForStoreParams {
  cursor?: string;
  limit: number;
}

export function listOrdersForStore(
  storeId: string,
  params: ListOrdersForStoreParams,
): Promise<OrdersPage> {
  return listOrdersForStoreRepo({ storeId, cursor: params.cursor, limit: params.limit });
}

const MANUAL_SYNC_LIMIT = 50;

/**
 * Pulls the most recent orders — the "Sync now" button, and also the only
 * gap-filler for orders placed before the webhook was registered. There is
 * no historical backfill beyond this bounded pull; a deliberate scope
 * limitation, not an oversight (see docs/api-assumptions.md).
 */
export async function manualSyncRecentOrders(
  storeId: string,
  correlationId: string,
  logger?: AppLogger,
): Promise<{ syncedCount: number }> {
  const store = await findStoreById(storeId);
  if (!store || !store.isActive) throw new AppError('STORE_INACTIVE');

  const ordersService = await requireOrdersService(store, correlationId, logger);
  const orders = await ordersService.listRecentOrders(MANUAL_SYNC_LIMIT);
  for (const order of orders) {
    await upsertOrder(mapBcOrderToUpsertInput(store.id, order));
  }

  // Self-heal: this is the recovery path if install-time webhook
  // registration failed. Deliberately not attached to the GET list route —
  // that fires on every page view, which would retry a real BigCommerce API
  // call forever if registration is persistently failing.
  if (store.ordersWebhookId === null) {
    void ensureOrdersWebhookRegistered(store, correlationId, logger).catch((error: unknown) => {
      logger?.warn({ err: error, storeId }, 'Failed to register the Orders webhook');
    });
  }

  return { syncedCount: orders.length };
}
