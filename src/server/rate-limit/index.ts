import { AppError } from '@/server/errors/app-error';

interface WindowState {
  count: number;
  windowStartMs: number;
}

/**
 * Fixed-window in-memory rate limiter. Sufficient for a single web
 * instance (the default Render starter deployment this app targets). If
 * the web service is scaled to multiple instances, replace this module's
 * storage with a shared store (e.g. Redis) — the call sites and interface
 * would not need to change.
 */
const buckets = new Map<string, WindowState>();

// Bound memory even if callers pass unbounded key cardinality (e.g. raw IPs).
const MAX_TRACKED_KEYS = 50_000;

export interface RateLimitCheck {
  allowed: boolean;
  remaining: number;
  retryAfterMs: number;
}

export function checkRateLimit(key: string, windowMs: number, max: number): RateLimitCheck {
  const now = Date.now();
  const existing = buckets.get(key);

  if (!existing || now - existing.windowStartMs >= windowMs) {
    if (buckets.size >= MAX_TRACKED_KEYS) {
      buckets.clear();
    }
    buckets.set(key, { count: 1, windowStartMs: now });
    return { allowed: true, remaining: max - 1, retryAfterMs: 0 };
  }

  if (existing.count >= max) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterMs: windowMs - (now - existing.windowStartMs),
    };
  }

  existing.count += 1;
  return { allowed: true, remaining: max - existing.count, retryAfterMs: 0 };
}

export function resetRateLimitStoreForTests(): void {
  buckets.clear();
}

/** Throws AppError('RATE_LIMITED') with retry context when the key's budget is exhausted. */
export function assertWithinRateLimit(key: string, windowMs: number, max: number): void {
  const result = checkRateLimit(key, windowMs, max);
  if (!result.allowed) {
    throw new AppError('RATE_LIMITED', {
      context: { retryAfterMs: result.retryAfterMs },
    });
  }
}
