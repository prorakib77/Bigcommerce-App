'use client';

import { useCallback, useEffect, useState } from 'react';
import { apiClient, ApiClientError } from './api-client';

export interface ApiDataState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

/** Shared GET-and-hold-state hook so pages don't each hand-roll loading/error plumbing. */
export function useApiData<T>(path: string | null, deps: unknown[] = []): ApiDataState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  const reload = useCallback(() => setReloadToken((t) => t + 1), []);

  useEffect(() => {
    if (!path) return;
    let cancelled = false;
    setLoading(true);
    setError(null);

    apiClient
      .get<T>(path)
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((err: unknown) => {
        if (!cancelled)
          setError(err instanceof ApiClientError ? err.message : 'Something went wrong.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [path, reloadToken, ...deps]);

  return { data, loading, error, reload };
}
