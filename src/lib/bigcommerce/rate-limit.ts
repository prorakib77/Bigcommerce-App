export interface BcRateLimitInfo {
  requestsRemaining: number | null;
  timeWindowMs: number | null;
  timeResetMs: number | null;
}

/** Parses BigCommerce's `X-Rate-Limit-*` response headers, present on every V3 API response. */
export function parseRateLimitHeaders(response: Response): BcRateLimitInfo {
  const parseIntHeader = (name: string): number | null => {
    const value = response.headers.get(name);
    if (!value) return null;
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : null;
  };

  return {
    requestsRemaining: parseIntHeader('x-rate-limit-requests-left'),
    timeWindowMs: parseIntHeader('x-rate-limit-time-window-ms'),
    timeResetMs: parseIntHeader('x-rate-limit-time-reset-ms'),
  };
}
