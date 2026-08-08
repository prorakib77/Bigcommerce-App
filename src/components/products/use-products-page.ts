'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiClient, ApiClientError } from '@/components/shared/api-client';
import type { ProductListItem } from './types';

const SEARCH_DEBOUNCE_MS = 400;

/**
 * BigCommerce's product pagination is page-number based (current_page /
 * total_pages), unlike Kickflip's cursor pagination — see
 * src/components/designs/use-designs-page.ts for the cursor-shaped
 * counterpart. `search` triggers a server-side request (not client-side
 * filtering like designs-view.tsx), so it's debounced.
 */
export function useProductsPage(page: number, limit: number, search: string) {
  const [items, setItems] = useState<ProductListItem[]>([]);
  const [currentPage, setCurrentPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const reload = useCallback(() => setReloadToken((t) => t + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);

    const timer = setTimeout(() => {
      const params = new URLSearchParams({ page: String(page), limit: String(limit) });
      if (search.trim()) params.set('search', search.trim());

      apiClient
        .getPaged<ProductListItem[]>(`/api/v1/bigcommerce/products?${params.toString()}`)
        .then((result) => {
          if (cancelled) return;
          setItems(result.items);
          setCurrentPage(result.currentPage);
          setTotalPages(result.totalPages);
        })
        .catch((err: unknown) => {
          if (cancelled) return;
          setError(err instanceof ApiClientError ? err.message : 'Could not load products.');
        })
        .finally(() => {
          if (!cancelled) setLoading(false);
        });
    }, SEARCH_DEBOUNCE_MS);

    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [page, limit, search, reloadToken]);

  return { items, currentPage, totalPages, loading, error, reload };
}
