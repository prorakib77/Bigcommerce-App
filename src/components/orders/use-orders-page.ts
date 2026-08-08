'use client';

import { useEffect, useState, useCallback } from 'react';
import { apiClient, ApiClientError } from '@/components/shared/api-client';
import type { OrderListItem } from './types';

/** Cursor-paginated (mirrors use-designs-page.ts) — this app's own Order table is an open-ended local log, same reason import history is cursor-paginated. */
export function useOrdersPage(cursor: string | null, limit: number) {
  const [items, setItems] = useState<OrderListItem[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const reload = useCallback(() => setReloadToken((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const path = `/api/v1/orders?limit=${limit}${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`;

    apiClient
      .getPage<OrderListItem[]>(path)
      .then((result) => {
        if (cancelled) return;
        setItems(result.items);
        setNextCursor(result.nextCursor);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof ApiClientError ? err.message : 'Could not load orders.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
  }, [cursor, limit, reloadToken]);

  return { items, nextCursor, loading, error, reload };
}
