/**
 * One narrow, explicit CORS exception for
 * src/app/api/public/storefront/customize-config/route.ts — the storefront
 * widget script fetches that endpoint cross-origin from the merchant's
 * storefront domain, so it needs a CORS header a same-origin app otherwise
 * never does. See SECURITY.md for why this is safe: the payload is public,
 * read-only, non-personalized, and carries no credentials.
 *
 * Deliberately not wired into src/server/http/handler.ts's publicRoute —
 * that would make every public route CORS-open by default. Callers wrap
 * their own route's exported handler with this instead.
 */
export interface CorsOptions {
  methods?: string;
  headers?: string;
}

export function withCorsHeaders(response: Response, options: CorsOptions = {}): Response {
  const headers = new Headers(response.headers);
  headers.set('Access-Control-Allow-Origin', '*');
  headers.set('Access-Control-Allow-Methods', options.methods ?? 'GET');
  if (options.headers) headers.set('Access-Control-Allow-Headers', options.headers);
  headers.set('Vary', 'Origin');
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers,
  });
}
