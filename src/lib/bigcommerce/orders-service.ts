import { getEnv } from '@/server/env';
import type { AppLogger } from '@/server/logging/logger';
import { BigCommerceApiClient } from './client';
import { getOrder, listRecentOrders } from './orders';
import type { BcOrder } from './schemas';

/**
 * Everything the Orders-sync feature needs from BigCommerce, behind one seam
 * — mirrors catalog-service.ts's BigCommerceCatalogService shape exactly.
 * Unlike the one-shot Script/Webhook *registration* side effects (which are
 * fine to hard-skip under MOCK_MODE — see orders-webhook-service.ts), order
 * data is this feature's core functionality, so it gets full mock parity:
 * the webhook receiver, the "Sync now" button, and integration tests all
 * exercise the exact same code path whether MOCK_MODE is on or off.
 */
export interface BigCommerceOrdersService {
  getOrder(orderId: number): Promise<BcOrder | null>;
  listRecentOrders(limit: number): Promise<BcOrder[]>;
}

export interface BigCommerceOrdersServiceOptions {
  storeHash: string;
  accessToken: string;
  correlationId: string;
  logger?: AppLogger;
}

class RealOrdersService implements BigCommerceOrdersService {
  private readonly client: BigCommerceApiClient;

  constructor(options: BigCommerceOrdersServiceOptions) {
    this.client = new BigCommerceApiClient(options);
  }

  getOrder(orderId: number): Promise<BcOrder | null> {
    return getOrder(this.client, orderId);
  }
  listRecentOrders(limit: number): Promise<BcOrder[]> {
    return listRecentOrders(this.client, limit);
  }
}

const FIXTURE_ORDERS: BcOrder[] = [
  {
    id: 500008,
    status: 'Awaiting Fulfillment',
    status_id: 11,
    total_inc_tax: '84.98',
    currency_code: 'USD',
    items_total: 2,
    date_created: '2026-08-06T14:32:00.000Z',
    billing_address: { first_name: 'Priya', last_name: 'Nair', email: 'priya.nair@example.com' },
  },
  {
    id: 500007,
    status: 'Completed',
    status_id: 10,
    total_inc_tax: '54.99',
    currency_code: 'USD',
    items_total: 1,
    date_created: '2026-08-05T09:14:00.000Z',
    billing_address: { first_name: 'Marcus', last_name: 'Webb', email: 'marcus.webb@example.com' },
  },
  {
    id: 500006,
    status: 'Awaiting Payment',
    status_id: 7,
    total_inc_tax: '129.50',
    currency_code: 'USD',
    items_total: 3,
    date_created: '2026-08-04T21:47:00.000Z',
    billing_address: { first_name: 'Ines', last_name: 'Duarte', email: 'ines.duarte@example.com' },
  },
  {
    id: 500005,
    status: 'Shipped',
    status_id: 2,
    total_inc_tax: '39.99',
    currency_code: 'USD',
    items_total: 1,
    date_created: '2026-08-03T11:02:00.000Z',
    billing_address: { first_name: 'Owen', last_name: 'Blackwood', email: 'owen.blackwood@example.com' },
  },
  {
    id: 500004,
    status: 'Cancelled',
    status_id: 5,
    total_inc_tax: '64.99',
    currency_code: 'USD',
    items_total: 1,
    date_created: '2026-08-02T16:20:00.000Z',
    billing_address: { first_name: 'Sofia', last_name: 'Reyes', email: 'sofia.reyes@example.com' },
  },
  {
    id: 500003,
    status: 'Awaiting Shipment',
    status_id: 9,
    total_inc_tax: '22.99',
    currency_code: 'USD',
    items_total: 1,
    date_created: '2026-08-02T08:55:00.000Z',
    billing_address: { first_name: 'Daniel', last_name: 'Frost', email: 'daniel.frost@example.com' },
  },
  {
    id: 500002,
    status: 'Refunded',
    status_id: 4,
    total_inc_tax: '44.99',
    currency_code: 'USD',
    items_total: 1,
    date_created: '2026-08-01T19:10:00.000Z',
    billing_address: { first_name: 'Hana', last_name: 'Kobayashi', email: 'hana.kobayashi@example.com' },
  },
  {
    id: 500001,
    status: 'Completed',
    status_id: 10,
    total_inc_tax: '99.98',
    currency_code: 'USD',
    items_total: 2,
    date_created: '2026-07-31T10:05:00.000Z',
    billing_address: { first_name: 'Leo', last_name: 'Novak', email: 'leo.novak@example.com' },
  },
];

/** In-memory BigCommerce Orders simulator for development/CI without real credentials. */
class MockOrdersService implements BigCommerceOrdersService {
  async getOrder(orderId: number): Promise<BcOrder | null> {
    return FIXTURE_ORDERS.find((order) => order.id === orderId) ?? null;
  }
  async listRecentOrders(limit: number): Promise<BcOrder[]> {
    return FIXTURE_ORDERS.slice(0, limit);
  }
}

const sharedMockOrdersService = new MockOrdersService();

export function createOrdersService(
  options: BigCommerceOrdersServiceOptions,
): BigCommerceOrdersService {
  if (getEnv().MOCK_MODE) {
    return sharedMockOrdersService;
  }
  return new RealOrdersService(options);
}
