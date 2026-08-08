'use client';

import { useState } from 'react';
import {
  Box,
  Flex,
  H1,
  Button,
  Select,
  Table,
  Text,
  ProgressCircle,
  Panel,
  Message,
} from '@bigcommerce/big-design';
import { apiClient, ApiClientError } from '@/components/shared/api-client';
import { ScrollableTable } from '@/components/shared/scrollable-table';
import type { OrderListItem } from './types';
import { OrderStatusBadge } from './order-status-badge';
import { useOrdersPage } from './use-orders-page';

const PAGE_SIZES = [10, 20, 50];

export function OrdersView(): React.JSX.Element {
  const [cursorStack, setCursorStack] = useState<Array<string | null>>([null]);
  const [limit, setLimit] = useState(20);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);
  const [syncing, setSyncing] = useState(false);

  const cursor = cursorStack[cursorStack.length - 1] ?? null;
  const { items, nextCursor, loading, error, reload } = useOrdersPage(cursor, limit);

  async function syncNow(): Promise<void> {
    setSyncing(true);
    setSyncMessage(null);
    try {
      const result = await apiClient.post<{ syncedCount: number }>('/api/v1/orders/sync');
      setSyncMessage(
        result.syncedCount === 1
          ? 'Synced 1 recent order.'
          : `Synced ${result.syncedCount} recent orders.`,
      );
      reload();
    } catch (err) {
      setSyncMessage(err instanceof ApiClientError ? err.message : 'Could not sync orders.');
    } finally {
      setSyncing(false);
    }
  }

  return (
    <Box>
      <Flex
        justifyContent="space-between"
        alignItems="center"
        flexWrap="wrap"
        flexGap="0.75rem"
        marginBottom="medium"
      >
        <H1 marginBottom="none">Orders</H1>
        <Flex flexWrap="wrap" flexGap="0.5rem">
          <Button variant="secondary" onClick={() => reload()} isLoading={loading}>
            Refresh
          </Button>
          <Button onClick={syncNow} isLoading={syncing}>
            Sync now
          </Button>
        </Flex>
      </Flex>

      <Text color="secondary60" marginBottom="medium">
        New orders appear here automatically as customers check out. &ldquo;Sync now&rdquo; pulls
        the most recent orders directly from BigCommerce — useful right after install, or to fill
        in any gap before the webhook was registered.
      </Text>

      {syncMessage && (
        <Box marginBottom="medium">
          <Message messages={[{ text: syncMessage }]} />
        </Box>
      )}

      <Flex marginBottom="medium" justifyContent="flex-end">
        <Select
          options={PAGE_SIZES.map((size) => ({ value: size, content: `${size} / page` }))}
          value={limit}
          onOptionChange={(value) => {
            setLimit(Number(value));
            setCursorStack([null]);
          }}
        />
      </Flex>

      {error && (
        <Panel header="Could not load orders">
          <Text>{error}</Text>
        </Panel>
      )}

      {loading && (
        <Flex justifyContent="center" padding="xLarge">
          <ProgressCircle size="large" />
        </Flex>
      )}

      {!loading && items.length === 0 && !error && (
        <Panel>
          <Text color="secondary60">No orders yet.</Text>
        </Panel>
      )}

      {!loading && items.length > 0 && (
        <ScrollableTable>
        <Table
          columns={[
            {
              header: 'Order #',
              hash: 'orderId',
              render: (item: OrderListItem) => `#${item.bigcommerceOrderId}`,
            },
            {
              header: 'Customer',
              hash: 'customer',
              render: (item: OrderListItem) => (
                <Box>
                  <Text marginBottom="none">{item.customerName ?? '—'}</Text>
                  {item.customerEmail && (
                    <Text color="secondary60" style={{ fontSize: '0.8rem' }}>
                      {item.customerEmail}
                    </Text>
                  )}
                </Box>
              ),
            },
            {
              header: 'Total',
              hash: 'total',
              render: (item: OrderListItem) => `${item.totalIncTax} ${item.currencyCode ?? ''}`,
            },
            {
              header: 'Status',
              hash: 'status',
              render: (item: OrderListItem) => <OrderStatusBadge status={item.status} />,
            },
            {
              header: 'Items',
              hash: 'items',
              render: (item: OrderListItem) => item.itemCount,
            },
            {
              header: 'Placed',
              hash: 'placed',
              render: (item: OrderListItem) =>
                item.orderCreatedAt ? new Date(item.orderCreatedAt).toLocaleString() : '—',
            },
          ]}
          items={items}
          stickyHeader
        />
        </ScrollableTable>
      )}

      <Flex justifyContent="flex-end" flexWrap="wrap" flexGap="0.5rem" marginTop="medium">
        <Button
          variant="secondary"
          disabled={cursorStack.length <= 1}
          onClick={() => setCursorStack((stack) => stack.slice(0, -1))}
        >
          Previous
        </Button>
        <Button
          variant="secondary"
          disabled={!nextCursor}
          onClick={() => setCursorStack((stack) => [...stack, nextCursor])}
        >
          Next
        </Button>
      </Flex>
    </Box>
  );
}
