import { computeBackoffDelayMs, computeRateLimitWaitMs } from './backoff';

export interface RetryPolicy {
  maxAttempts: number;
  baseDelayMs: number;
  maxDelayMs: number;
  /** HTTP status codes worth retrying (e.g. 429 and selected 5xx). Never validation/permission codes. */
  retryableStatusCodes: number[];
  /** Extracts a server-provided wait time (ms) from a response, e.g. from rate-limit headers. */
  getServerWaitMs?: (response: Response) => number | null;
}

export interface FetchWithRetryOptions {
  connectTimeoutMs: number;
  requestTimeoutMs: number;
  signal?: AbortSignal;
  onAttempt?: (info: {
    attempt: number;
    status?: number;
    willRetry: boolean;
    delayMs: number;
  }) => void;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Fetch wrapper shared by the Kickflip and BigCommerce clients: bounded
 * retries with exponential backoff + jitter for transient network errors
 * and a configurable set of retryable status codes, a hard attempt cap so
 * this can never become a tight retry loop, and both a connect-phase and
 * total-request timeout via AbortController.
 */
export async function fetchWithRetry(
  input: string | URL,
  init: RequestInit,
  policy: RetryPolicy,
  options: FetchWithRetryOptions,
): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= policy.maxAttempts; attempt += 1) {
    const controller = new AbortController();
    const onExternalAbort = () => controller.abort();
    options.signal?.addEventListener('abort', onExternalAbort);

    const connectTimer = setTimeout(() => controller.abort(), options.connectTimeoutMs);
    const totalTimer = setTimeout(() => controller.abort(), options.requestTimeoutMs);

    try {
      const response = await fetch(input, { ...init, signal: controller.signal });
      clearTimeout(connectTimer);
      clearTimeout(totalTimer);

      const isRetryableStatus = policy.retryableStatusCodes.includes(response.status);
      const isLastAttempt = attempt === policy.maxAttempts;

      if (!isRetryableStatus || isLastAttempt) {
        options.onAttempt?.({ attempt, status: response.status, willRetry: false, delayMs: 0 });
        return response;
      }

      const serverWaitMs = policy.getServerWaitMs?.(response) ?? null;
      const delayMs =
        serverWaitMs != null
          ? computeRateLimitWaitMs(serverWaitMs, attempt, policy.baseDelayMs, policy.maxDelayMs)
          : computeBackoffDelayMs(attempt, policy.baseDelayMs, policy.maxDelayMs);

      options.onAttempt?.({ attempt, status: response.status, willRetry: true, delayMs });
      await sleep(delayMs);
    } catch (error) {
      clearTimeout(connectTimer);
      clearTimeout(totalTimer);
      lastError = error;

      if (options.signal?.aborted) {
        throw error;
      }

      const isLastAttempt = attempt === policy.maxAttempts;
      if (isLastAttempt) {
        throw error;
      }

      const delayMs = computeBackoffDelayMs(attempt, policy.baseDelayMs, policy.maxDelayMs);
      options.onAttempt?.({ attempt, willRetry: true, delayMs });
      await sleep(delayMs);
    } finally {
      options.signal?.removeEventListener('abort', onExternalAbort);
    }
  }

  throw lastError ?? new Error('fetchWithRetry exhausted attempts without a response');
}
