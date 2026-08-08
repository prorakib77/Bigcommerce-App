import { getEnv } from '@/server/env';
import type { AppLogger } from '@/server/logging/logger';
import { fetchWithRetry } from '@/server/http/fetch-with-retry';
import { mapBigCommerceHttpError } from './errors';
import { parseRateLimitHeaders, type BcRateLimitInfo } from './rate-limit';

const RETRYABLE_STATUS_CODES = [429, 502, 503, 504];

export interface BigCommerceClientOptions {
  storeHash: string;
  accessToken: string;
  correlationId: string;
  logger?: AppLogger;
  baseUrl?: string;
  connectTimeoutMs?: number;
  requestTimeoutMs?: number;
  maxAttempts?: number;
}

export interface BcRequestResult<T> {
  data: T;
  rateLimit: BcRateLimitInfo;
}

/**
 * Authenticated V3 Catalog API client. Every call goes through the shared
 * retry/backoff/timeout wrapper, honors BigCommerce's rate-limit reset
 * headers on 429, and never logs the access token.
 */
export class BigCommerceApiClient {
  private readonly baseUrl: string;
  private readonly connectTimeoutMs: number;
  private readonly requestTimeoutMs: number;
  private readonly maxAttempts: number;

  private readonly storeRootUrl: string;

  constructor(private readonly options: BigCommerceClientOptions) {
    const env = getEnv();
    this.storeRootUrl = `${options.baseUrl ?? env.BIGCOMMERCE_API_BASE_URL}/stores/${options.storeHash}`;
    this.baseUrl = `${this.storeRootUrl}/v3`;
    this.connectTimeoutMs = options.connectTimeoutMs ?? env.HTTP_CONNECT_TIMEOUT_MS;
    this.requestTimeoutMs = options.requestTimeoutMs ?? env.HTTP_REQUEST_TIMEOUT_MS;
    this.maxAttempts = options.maxAttempts ?? 4;
  }

  private headers(extra?: HeadersInit): HeadersInit {
    return {
      'X-Auth-Token': this.options.accessToken,
      Accept: 'application/json',
      ...extra,
    };
  }

  async requestJson<T>(
    method: string,
    path: string,
    init: {
      body?: unknown;
      query?: Record<string, string | number | undefined>;
      signal?: AbortSignal;
      apiVersion?: 'v2' | 'v3';
    } = {},
  ): Promise<BcRequestResult<T>> {
    const base = init.apiVersion === 'v2' ? `${this.storeRootUrl}/v2` : this.baseUrl;
    const url = new URL(`${base}${path}`);
    for (const [key, value] of Object.entries(init.query ?? {})) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    const response = await fetchWithRetry(
      url,
      {
        method,
        headers: this.headers(
          init.body !== undefined ? { 'Content-Type': 'application/json' } : undefined,
        ),
        body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
        signal: init.signal,
      },
      {
        maxAttempts: this.maxAttempts,
        baseDelayMs: 300,
        maxDelayMs: 8_000,
        retryableStatusCodes: RETRYABLE_STATUS_CODES,
        getServerWaitMs: (res) => parseRateLimitHeaders(res).timeResetMs,
      },
      {
        connectTimeoutMs: this.connectTimeoutMs,
        requestTimeoutMs: this.requestTimeoutMs,
        signal: init.signal,
        onAttempt: (info) =>
          this.options.logger?.warn(
            { correlationId: this.options.correlationId, ...info },
            'BigCommerce API attempt',
          ),
      },
    );

    const rateLimit = parseRateLimitHeaders(response);

    if (!response.ok) {
      let context: Record<string, unknown> | undefined;
      try {
        context = { body: await response.json() };
      } catch {
        context = undefined;
      }
      throw mapBigCommerceHttpError(response.status, context);
    }

    if (response.status === 204) {
      return { data: undefined as T, rateLimit };
    }

    const json = (await response.json()) as T;
    return { data: json, rateLimit };
  }

  /** For multipart/form-data uploads (product image upload). Caller supplies a pre-built FormData. */
  async requestMultipart<T>(
    method: string,
    path: string,
    formData: FormData,
    signal?: AbortSignal,
  ): Promise<BcRequestResult<T>> {
    const url = new URL(`${this.baseUrl}${path}`);

    const response = await fetchWithRetry(
      url,
      { method, headers: this.headers(), body: formData, signal },
      {
        maxAttempts: this.maxAttempts,
        baseDelayMs: 300,
        maxDelayMs: 8_000,
        retryableStatusCodes: RETRYABLE_STATUS_CODES,
        getServerWaitMs: (res) => parseRateLimitHeaders(res).timeResetMs,
      },
      { connectTimeoutMs: this.connectTimeoutMs, requestTimeoutMs: this.requestTimeoutMs, signal },
    );

    const rateLimit = parseRateLimitHeaders(response);
    if (!response.ok) {
      throw mapBigCommerceHttpError(response.status);
    }
    const json = (await response.json()) as T;
    return { data: json, rateLimit };
  }
}
