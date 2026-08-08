import { getEnv } from '@/server/env';

/**
 * Exact-hostname allowlist match (case-insensitive). Subdomains are NOT
 * implicitly trusted — `cdn.mycustomizer.com` does not authorize
 * `evil.cdn.mycustomizer.com` or `mycustomizer.com`. Each trusted host must
 * be listed explicitly in `KICKFLIP_ALLOWED_IMAGE_HOSTS`.
 */
export function isAllowedImageHost(
  hostname: string,
  allowedHosts: string[] = getEnv().KICKFLIP_ALLOWED_IMAGE_HOSTS,
): boolean {
  const normalized = hostname.toLowerCase();
  return allowedHosts.some((allowed) => allowed.toLowerCase() === normalized);
}

/** Parses a URL with the platform parser and validates it's HTTPS + on the allowlist. Throws on failure via the caller. */
export function parseAndValidateImageUrl(
  rawUrl: string,
  allowedHosts: string[] = getEnv().KICKFLIP_ALLOWED_IMAGE_HOSTS,
): { url: URL; allowed: boolean } {
  const url = new URL(rawUrl);
  const allowed = url.protocol === 'https:' && isAllowedImageHost(url.hostname, allowedHosts);
  return { url, allowed };
}
