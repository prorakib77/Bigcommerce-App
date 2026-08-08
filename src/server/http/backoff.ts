/**
 * Full-jitter exponential backoff: doubles per attempt, capped at
 * `maxDelayMs`, then scaled by a random factor in [0.5, 1) so many
 * concurrent retries don't all land on the same tick.
 */
export function computeBackoffDelayMs(
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
): number {
  const capped = Math.min(maxDelayMs, baseDelayMs * 2 ** Math.max(attempt - 1, 0));
  const jittered = capped * (0.5 + Math.random() * 0.5);
  return Math.round(jittered);
}

/**
 * For 429s that include a server-provided wait time: honor whichever is
 * longer between that and this attempt's exponential backoff, then add a
 * small amount of jitter on top so retries from many stores don't
 * synchronize on the same reset boundary.
 */
export function computeRateLimitWaitMs(
  serverWaitMs: number,
  attempt: number,
  baseDelayMs: number,
  maxDelayMs: number,
  jitterMaxMs = 500,
): number {
  const backoff = computeBackoffDelayMs(attempt, baseDelayMs, maxDelayMs);
  const longest = Math.max(Math.max(serverWaitMs, 0), backoff);
  return longest + Math.floor(Math.random() * jitterMaxMs);
}
