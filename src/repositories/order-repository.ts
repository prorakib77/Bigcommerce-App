import type { Order } from '@prisma/client';
import { prisma } from '@/server/db/prisma';

export interface UpsertOrderInput {
  storeId: string;
  bigcommerceOrderId: number;
  status: string;
  statusId: number | null;
  customerName: string | null;
  customerEmail: string | null;
  totalIncTax: string;
  currencyCode: string | null;
  itemCount: number;
  orderCreatedAt: Date | null;
}

export async function upsertOrder(input: UpsertOrderInput): Promise<Order> {
  return prisma.order.upsert({
    where: {
      storeId_bigcommerceOrderId: { storeId: input.storeId, bigcommerceOrderId: input.bigcommerceOrderId },
    },
    update: {
      status: input.status,
      statusId: input.statusId,
      customerName: input.customerName,
      customerEmail: input.customerEmail,
      totalIncTax: input.totalIncTax,
      currencyCode: input.currencyCode,
      itemCount: input.itemCount,
      orderCreatedAt: input.orderCreatedAt,
    },
    create: {
      storeId: input.storeId,
      bigcommerceOrderId: input.bigcommerceOrderId,
      status: input.status,
      statusId: input.statusId,
      customerName: input.customerName,
      customerEmail: input.customerEmail,
      totalIncTax: input.totalIncTax,
      currencyCode: input.currencyCode,
      itemCount: input.itemCount,
      orderCreatedAt: input.orderCreatedAt,
    },
  });
}

export interface ListOrdersFilter {
  storeId: string;
  cursor?: string;
  limit: number;
}

export interface OrdersPage {
  items: Order[];
  nextCursor: string | null;
}

/**
 * Cursor-paginated over this app's own Order table (an open-ended local
 * log), mirroring import-repository.ts's listImportRuns — not a live proxy
 * of a remote paginated API the way the Products page's page-number
 * pagination mirrors BigCommerce's own V3/V2 page contracts.
 */
export async function listOrdersForStore(filter: ListOrdersFilter): Promise<OrdersPage> {
  const items = await prisma.order.findMany({
    where: { storeId: filter.storeId },
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
