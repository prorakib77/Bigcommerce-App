import { getEnv } from '@/server/env';
import type { AppLogger } from '@/server/logging/logger';
import { redactUrl } from '@/server/logging/redaction';
import { fetchWithRetry } from '@/server/http/fetch-with-retry';
import { AppError } from '@/server/errors/app-error';
import { normalizeDesign } from './mapper';
import { kickflipDesignsResponseSchema, type KickflipDesignsResponse } from './schemas';
import { mapKickflipHttpError } from './errors';
import type {
  KickflipCredentials,
  KickflipDesignsPage,
  ListDesignsParams,
  NormalizedKickflipDesign,
  TestConnectionResult,
} from './types';

const RETRYABLE_STATUS_CODES = [429, 502, 503, 504];

export interface KickflipClientOptions {
  baseUrl?: string;
  connectTimeoutMs?: number;
  requestTimeoutMs?: number;
  maxAttempts?: number;
  logger?: AppLogger;
}

export interface ListDesignsResult {
  page: KickflipDesignsPage;
  /** Records that failed schema validation and were skipped rather than crashing the page. */
  skippedCount: number;
}

/**
 * Thin, documented-endpoints-only Kickflip API client. Every HTTP call goes
 * through the shared retry/backoff/timeout wrapper; every response is
 * validated before it's trusted. See docs/api-assumptions.md for exactly
 * which endpoint and response shape this was built against.
 */
export class KickflipClient {
  private readonly baseUrl: string;
  private readonly connectTimeoutMs: number;
  private readonly requestTimeoutMs: number;
  private readonly maxAttempts: number;
  private readonly logger?: AppLogger;

  constructor(
    private readonly credentials: KickflipCredentials,
    options: KickflipClientOptions = {},
  ) {
    const env = getEnv();
    this.baseUrl = options.baseUrl ?? env.KICKFLIP_API_BASE_URL;
    this.connectTimeoutMs = options.connectTimeoutMs ?? env.HTTP_CONNECT_TIMEOUT_MS;
    this.requestTimeoutMs = options.requestTimeoutMs ?? env.HTTP_REQUEST_TIMEOUT_MS;
    this.maxAttempts = options.maxAttempts ?? 4;
    this.logger = options.logger;
  }

  private headers(): HeadersInit {
    return {
      Authorization: `Bearer ${this.credentials.apiToken}`,
      'X-TENANT-ID': this.credentials.tenantId,
      Accept: 'application/json',
    };
  }

  private async request(
    path: string,
    query: Record<string, string | number | undefined>,
    correlationId: string,
    signal?: AbortSignal,
  ): Promise<Response> {
    // NOT `new URL(path, this.baseUrl)`: when `path` starts with "/" (as it
    // always does here), the two-argument form treats it as an absolute
    // path and silently discards `this.baseUrl`'s own path (e.g. the "/v1"
    // in https://api.gokickflip.com/v1) — confirmed live against the real
    // API on 2026-08-02, where this was resolving to
    // https://api.gokickflip.com/designs instead of .../v1/designs.
    const url = new URL(`${this.baseUrl}${path}`);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    this.logger?.debug({ correlationId, url: redactUrl(url.toString()) }, 'Kickflip API request');

    return fetchWithRetry(
      url,
      { method: 'GET', headers: this.headers(), signal },
      {
        maxAttempts: this.maxAttempts,
        baseDelayMs: 300,
        maxDelayMs: 5_000,
        retryableStatusCodes: RETRYABLE_STATUS_CODES,
        getServerWaitMs: (response) => {
          const retryAfter = response.headers.get('retry-after');
          if (!retryAfter) return null;
          const seconds = Number(retryAfter);
          return Number.isFinite(seconds) ? seconds * 1000 : null;
        },
      },
      {
        connectTimeoutMs: this.connectTimeoutMs,
        requestTimeoutMs: this.requestTimeoutMs,
        signal,
        onAttempt: (info) => this.logger?.warn({ correlationId, ...info }, 'Kickflip API attempt'),
      },
    );
  }

  /**
   * Verifies the tenant ID and token are valid by requesting a single page
   * of the documented designs-list endpoint. Deliberately reuses that
   * endpoint rather than a speculative "ping"/"whoami" endpoint that isn't
   * documented.
   */
  async testConnection(correlationId: string, signal?: AbortSignal): Promise<TestConnectionResult> {
    const response = await this.request(
      '/designs',
      { limit: 1, sortOrder: 'descending', sortKey: 'designId' },
      correlationId,
      signal,
    );

    if (!response.ok) {
      throw mapKickflipHttpError(response.status);
    }

    return { ok: true, verifiedAt: new Date() };
  }

  async listDesigns(params: ListDesignsParams): Promise<ListDesignsResult> {
    const response = await this.request(
      '/designs',
      {
        cursor: params.cursor ?? undefined,
        limit: params.limit,
        sortOrder: 'descending',
        sortKey: 'designId',
      },
      params.correlationId,
      params.signal,
    );

    if (!response.ok) {
      throw mapKickflipHttpError(response.status);
    }

    const json: unknown = await response.json();
    const parsedEnvelope = kickflipDesignsResponseSchema.safeParse(json);
    if (!parsedEnvelope.success) {
      throw new AppError('KICKFLIP_SCHEMA_MISMATCH', {
        publicDetail: 'The design list response was not in the expected format.',
      });
    }

    // Real API returns `results`; `data` is a tolerated fallback shape — see schemas.ts.
    const rawItems = parsedEnvelope.data.results ?? parsedEnvelope.data.data ?? [];

    const items: NormalizedKickflipDesign[] = [];
    let skippedCount = 0;
    for (const rawItem of rawItems) {
      const result = normalizeDesign(rawItem);
      if (result.ok) {
        items.push(result.design);
      } else {
        skippedCount += 1;
        this.logger?.warn(
          {
            correlationId: params.correlationId,
            reason: result.reason,
            externalId: result.externalId,
          },
          'Skipped a malformed Kickflip design record',
        );
      }
    }

    const nextCursor = this.deriveNextCursor(parsedEnvelope.data, rawItems.length);

    return { page: { items, nextCursor }, skippedCount };
  }

  /**
   * The real API's `pagination` object is index/offset-based
   * (`collectionSize`/`resultSize`/`lastIndex`), not an opaque cursor
   * token — confirmed against a live (empty) response on 2026-08-02, but
   * not yet verified against a populated multi-page response, since the
   * only real account tested so far had zero saved designs. Treats
   * `lastIndex + 1` as the next page's offset, sent back as the `cursor`
   * query param (same param name the brief specified). Falls back to the
   * legacy cursor/meta fields for tolerance. Re-verify this once real
   * multi-page data is available — see docs/api-assumptions.md.
   */
  private deriveNextCursor(
    envelope: KickflipDesignsResponse,
    receivedCount: number,
  ): string | null {
    const pagination = envelope.pagination;
    if (pagination && typeof pagination.lastIndex === 'number') {
      const collectionSize = pagination.collectionSize ?? 0;
      const hasMore = receivedCount > 0 && pagination.lastIndex + 1 < collectionSize;
      return hasMore ? String(pagination.lastIndex + 1) : null;
    }
    return (
      envelope.cursor ?? envelope.nextCursor ?? envelope.meta?.cursor ?? envelope.meta?.nextCursor ?? null
    );
  }

  /**
   * Assumes `GET /designs/{designId}` as the natural single-resource
   * extension of the documented `/designs` collection endpoint — flagged
   * explicitly in docs/api-assumptions.md as an assumption to verify
   * against the real API, not an undocumented/reverse-engineered endpoint.
   * Falls back to searching the first page of the list endpoint if this
   * route 404s, so the feature degrades rather than breaking outright.
   */
  async getDesign(
    designId: string,
    correlationId: string,
    signal?: AbortSignal,
  ): Promise<NormalizedKickflipDesign> {
    const response = await this.request(
      `/designs/${encodeURIComponent(designId)}`,
      {},
      correlationId,
      signal,
    );

    if (response.ok) {
      const json: unknown = await response.json();
      const result = normalizeDesign(json);
      if (result.ok) return result.design;
      throw new AppError('KICKFLIP_SCHEMA_MISMATCH', {
        publicDetail: 'The design response was not in the expected format.',
      });
    }

    if (response.status !== 404) {
      throw mapKickflipHttpError(response.status);
    }

    const listResult = await this.listDesigns({ limit: 50, correlationId, signal });
    const found = listResult.page.items.find((item) => item.externalId === designId);
    if (!found) {
      throw new AppError('KICKFLIP_DESIGN_NOT_FOUND');
    }
    return found;
  }
}
