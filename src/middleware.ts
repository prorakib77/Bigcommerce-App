import { NextResponse, type NextRequest } from 'next/server';

// Middleware runs on the Edge runtime, before src/server/env's Node-only
// validation is available, so BigCommerce's iframe hosts and the Kickflip
// image-host allowlist are read directly from process.env here rather than
// importing the shared `env` singleton (which pulls in Node crypto/pino).
const BIGCOMMERCE_FRAME_ANCESTORS = 'https://*.bigcommerce.com https://*.mybigcommerce.com';

function buildCsp(nonce: string): string {
  const allowedImageHosts = (process.env.KICKFLIP_ALLOWED_IMAGE_HOSTS ?? '')
    .split(',')
    .map((h) => h.trim())
    .filter(Boolean)
    .map((h) => `https://${h}`)
    .join(' ');

  // React/Turbopack dev mode uses eval() for HMR and dev-only debugging
  // features (never in production — see
  // https://nextjs.org/docs/messages/no-unsafe-eval-csp, a documented,
  // dev-only CSP relaxation). Production's script-src stays exactly as
  // strict as before: no 'unsafe-eval'.
  const scriptSrc =
    process.env.NODE_ENV === 'production'
      ? `script-src 'self' 'nonce-${nonce}' 'strict-dynamic'`
      : `script-src 'self' 'unsafe-eval' 'nonce-${nonce}' 'strict-dynamic'`;

  return [
    "default-src 'none'",
    scriptSrc,
    // styled-components v5 injects <style> tags without per-tag nonce
    // support; documented trade-off in SECURITY.md.
    "style-src 'self' 'unsafe-inline'",
    `img-src 'self' data: ${allowedImageHosts}`.trim(),
    "font-src 'self'",
    "connect-src 'self'",
    "object-src 'none'",
    "base-uri 'none'",
    "form-action 'self'",
    "frame-src 'none'",
    `frame-ancestors ${BIGCOMMERCE_FRAME_ANCESTORS}`,
    'upgrade-insecure-requests',
  ]
    .join('; ')
    .trim();
}

export function middleware(request: NextRequest): NextResponse {
  const nonce = Buffer.from(crypto.randomUUID()).toString('base64');
  const csp = buildCsp(nonce);

  const requestHeaders = new Headers(request.headers);
  requestHeaders.set('x-nonce', nonce);

  const response = NextResponse.next({ request: { headers: requestHeaders } });

  response.headers.set('Content-Security-Policy', csp);
  response.headers.set('X-Content-Type-Options', 'nosniff');
  response.headers.set('Referrer-Policy', 'strict-origin-when-cross-origin');
  response.headers.set(
    'Permissions-Policy',
    'camera=(), microphone=(), geolocation=(), payment=()',
  );
  // Intentionally no X-Frame-Options: this app must be iframe-able by
  // BigCommerce; frame-ancestors above is the modern, precise replacement.
  if (process.env.NODE_ENV === 'production') {
    response.headers.set('Strict-Transport-Security', 'max-age=63072000; includeSubDomains');
  }

  return response;
}

export const config = {
  matcher: [
    /*
     * Match all request paths except:
     * - _next/static, _next/image (build assets)
     * - favicon.ico
     */
    '/((?!_next/static|_next/image|favicon.ico).*)',
  ],
};
