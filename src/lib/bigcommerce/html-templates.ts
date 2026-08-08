function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Minimal, dependency-free HTML page for the top-level (non-iframe)
 * responses BigCommerce navigates the merchant's browser to during install
 * and uninstall. Deliberately not the React app shell — no JS bundle, no
 * external assets, nothing that can fail to load.
 */
export function renderResultPage(params: {
  title: string;
  heading: string;
  message: string;
  tone: 'success' | 'error';
}): string {
  const accent = params.tone === 'success' ? '#1a7f37' : '#b3261e';
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<meta name="robots" content="noindex, nofollow" />
<title>${escapeHtml(params.title)}</title>
<style>
  body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; background: #f5f6f7; margin: 0; display: flex; min-height: 100vh; align-items: center; justify-content: center; }
  .card { background: #fff; border-radius: 8px; box-shadow: 0 1px 3px rgba(0,0,0,0.12); padding: 2.5rem; max-width: 28rem; text-align: center; }
  h1 { color: ${accent}; font-size: 1.25rem; margin: 0 0 0.75rem; }
  p { color: #33383d; line-height: 1.5; margin: 0; }
</style>
</head>
<body>
  <main class="card">
    <h1>${escapeHtml(params.heading)}</h1>
    <p>${escapeHtml(params.message)}</p>
  </main>
</body>
</html>`;
}

export function htmlResponse(html: string, status = 200): Response {
  return new Response(html, {
    status,
    headers: { 'Content-Type': 'text/html; charset=utf-8', 'Cache-Control': 'no-store' },
  });
}
