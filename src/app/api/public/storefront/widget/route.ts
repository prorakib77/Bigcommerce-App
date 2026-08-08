import { getEnv } from '@/server/env';
import { renderStorefrontWidgetScript } from '@/lib/bigcommerce/storefront-widget';

export const dynamic = 'force-dynamic';

/**
 * Public, unauthenticated: the storefront Customize-button widget, loaded
 * via a `<script src>` tag BigCommerce Script Manager inserts on every
 * storefront page (registered at install time — see
 * src/services/storefront-script-service.ts). The body is identical for
 * every store — the storeHash travels in this script's own registered `src`
 * query string, read at runtime by the script itself — so the response is
 * safely cacheable. No CORS headers needed here: `<script src>` loading
 * isn't subject to CORS (only the config-fetch endpoint the script itself
 * calls needs that — see ../customize-config/route.ts).
 */
export function GET(): Response {
  const script = renderStorefrontWidgetScript({ appBaseUrl: getEnv().APP_BASE_URL });
  return new Response(script, {
    status: 200,
    headers: {
      'Content-Type': 'application/javascript; charset=utf-8',
      'Cache-Control': 'public, max-age=300',
    },
  });
}
