import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { getEnv } from '@/server/env';

/** Deterministic SHA-256 hash, hex-encoded. Used for session-token lookups. */
export function sha256Hex(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/**
 * Privacy-safe, non-reversible identifier for a request IP. Keyed with the
 * master encryption key so hashes can't be brute-forced against known IPs
 * without server secrets, while still being stable enough to correlate
 * repeated requests from the same address for rate limiting / audit.
 */
export function hashIpAddress(ip: string): string {
  return createHmac('sha256', getEnv().MASTER_ENCRYPTION_KEY).update(ip).digest('hex').slice(0, 32);
}

/**
 * Constant-time string comparison for security-bearing shared secrets (e.g.
 * the Orders webhook's header secret — see
 * src/services/orders-webhook-service.ts). `null`/`undefined`/length
 * mismatches short-circuit to `false` *before* `timingSafeEqual`, which
 * throws on unequal-length buffers rather than returning `false`.
 */
export function timingSafeEqualStrings(
  a: string | null | undefined,
  b: string | null | undefined,
): boolean {
  if (!a || !b) return false;
  const bufA = Buffer.from(a, 'utf8');
  const bufB = Buffer.from(b, 'utf8');
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}
