'use client';

/**
 * Thin fetch wrapper shared by every client component. Centralizes
 * attaching the in-memory bearer token, JSON envelope unwrapping, and
 * mapping API error envelopes to a single `ApiClientError` type — no
 * component should call `fetch` directly.
 */
export class ApiClientError extends Error {
  constructor(
    public readonly code: string,
    message: string,
    public readonly requestId: string | undefined,
    public readonly status: number,
  ) {
    super(message);
    this.name = 'ApiClientError';
  }
}

let currentToken: string | null = null;

export function setApiToken(token: string | null): void {
  currentToken = token;
}

export function getApiToken(): string | null {
  return currentToken;
}

export function hasApiToken(): boolean {
  return currentToken !== null;
}

interface ApiSuccessEnvelope<T> {
  data: T;
  meta: { requestId: string } & Record<string, unknown>;
}

interface ApiErrorEnvelope {
  error: { code: string; message: string; requestId: string };
}

async function requestEnvelope<T>(
  path: string,
  init: RequestInit = {},
): Promise<ApiSuccessEnvelope<T>> {
  const headers = new Headers(init.headers);
  headers.set('Accept', 'application/json');
  if (init.body && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  if (currentToken) {
    headers.set('Authorization', `Bearer ${currentToken}`);
  }

  const response = await fetch(path, { ...init, headers });
  const json = (await response.json().catch(() => null)) as
    ApiSuccessEnvelope<T> | ApiErrorEnvelope | null;

  if (!response.ok || !json || 'error' in json) {
    const errorBody = json && 'error' in json ? json.error : null;
    throw new ApiClientError(
      errorBody?.code ?? 'INTERNAL_ERROR',
      errorBody?.message ?? 'Something went wrong. Please try again.',
      errorBody?.requestId,
      response.status,
    );
  }

  return json;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const envelope = await requestEnvelope<T>(path, init);
  return envelope.data;
}

export const apiClient = {
  get: <T>(path: string) => request<T>(path, { method: 'GET' }),
  /** For cursor-paginated list endpoints: returns the items plus the `nextCursor` from `meta`. */
  getPage: async <T>(path: string): Promise<{ items: T; nextCursor: string | null }> => {
    const envelope = await requestEnvelope<T>(path, { method: 'GET' });
    return {
      items: envelope.data,
      nextCursor: (envelope.meta.nextCursor as string | null) ?? null,
    };
  },
  /** For page-number-paginated list endpoints (e.g. BigCommerce products/categories): returns the items plus `currentPage`/`totalPages` from `meta`. */
  getPaged: async <T>(path: string): Promise<{ items: T; currentPage: number; totalPages: number }> => {
    const envelope = await requestEnvelope<T>(path, { method: 'GET' });
    return {
      items: envelope.data,
      currentPage: (envelope.meta.currentPage as number | undefined) ?? 1,
      totalPages: (envelope.meta.totalPages as number | undefined) ?? 1,
    };
  },
  post: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: 'POST',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  put: <T>(path: string, body?: unknown) =>
    request<T>(path, {
      method: 'PUT',
      body: body !== undefined ? JSON.stringify(body) : undefined,
    }),
  delete: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};
