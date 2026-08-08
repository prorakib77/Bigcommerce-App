/**
 * Generates the vanilla-JS storefront widget served at
 * src/app/api/public/storefront/widget/route.ts and auto-registered via
 * BigCommerce Script Manager (src/services/storefront-script-service.ts).
 *
 * Same philosophy as html-templates.ts's renderResultPage: no JS bundle, no
 * external assets, nothing that can fail to load — and, since this runs
 * unsupervised on a merchant's live storefront, it must never throw an
 * uncaught error into the page.
 *
 * FLAGGED assumptions this script makes about the storefront environment
 * (see docs/api-assumptions.md for the full writeup):
 *  - `document.currentScript` is available, i.e. Script Manager inserts a
 *    plain classic `<script src>` tag (not async/module) — used to recover
 *    the storeHash baked into this script's own `src` query string.
 *  - `window.BCData.product_attributes.id` exists — a Stencil/Cornerstone
 *    convention, absent on other themes or non-product pages.
 *  - `#form-action-addToCart` is the Add to Cart button id — Cornerstone-
 *    specific, best-effort.
 * Every one of these is checked defensively; absence is always a silent
 * no-op, never a thrown error.
 */
export function renderStorefrontWidgetScript(params: { appBaseUrl: string }): string {
  const appBaseUrlLiteral = JSON.stringify(params.appBaseUrl);

  return `(function () {
  try {
    var APP_BASE_URL = ${appBaseUrlLiteral};

    var scriptEl = document.currentScript;
    if (!scriptEl || !scriptEl.src) return;

    var scriptUrl;
    try {
      scriptUrl = new URL(scriptEl.src);
    } catch (e) {
      return;
    }
    var storeHash = scriptUrl.searchParams.get('storeHash');
    if (!storeHash) return;

    var bcData = window.BCData;
    var productId = bcData && bcData.product_attributes && bcData.product_attributes.id;
    if (!productId) return;

    var configUrl =
      APP_BASE_URL +
      '/api/public/storefront/customize-config?storeHash=' +
      encodeURIComponent(storeHash) +
      '&productId=' +
      encodeURIComponent(String(productId));

    function openCustomizeOverlay(url, label) {
      var overlay = document.createElement('div');
      overlay.style.cssText =
        'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.6);' +
        'z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:1.5rem;';

      var panel = document.createElement('div');
      panel.style.cssText =
        'position:relative;background:#fff;width:100%;max-width:56rem;height:85vh;' +
        'border-radius:8px;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,0.35);';

      var closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.setAttribute('aria-label', 'Close ' + (label || 'Customize'));
      closeBtn.textContent = String.fromCharCode(215);
      closeBtn.style.cssText =
        'position:absolute;top:0.5rem;right:0.5rem;width:2rem;height:2rem;border:none;' +
        'border-radius:50%;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,0.3);' +
        'font-size:1.25rem;line-height:1;cursor:pointer;z-index:1;';

      var iframe = document.createElement('iframe');
      iframe.src = url;
      iframe.style.cssText = 'width:100%;height:100%;border:0;display:block;';

      function onKeydown(e) {
        if (e.key === 'Escape') close();
      }
      function close() {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        document.removeEventListener('keydown', onKeydown);
      }

      closeBtn.addEventListener('click', close);
      overlay.addEventListener('click', function (e) {
        if (e.target === overlay) close();
      });
      document.addEventListener('keydown', onKeydown);

      panel.appendChild(closeBtn);
      panel.appendChild(iframe);
      overlay.appendChild(panel);
      document.body.appendChild(overlay);
    }

    fetch(configUrl, { method: 'GET' })
      .then(function (res) {
        return res && res.ok ? res.json() : null;
      })
      .then(function (config) {
        if (!config || !config.enabled || !config.customizeUrl) return;

        var addToCartBtn = document.getElementById('form-action-addToCart');
        if (!addToCartBtn || !addToCartBtn.parentNode) return;

        var label = config.buttonLabel || 'Customize';
        var button = document.createElement('button');
        button.type = 'button';
        button.textContent = label;
        button.style.cssText =
          'display:block;width:100%;margin-top:0.75rem;padding:0.75rem 1rem;' +
          'font-size:1rem;font-weight:600;color:#fff;background:#3c64f4;' +
          'border:none;border-radius:4px;cursor:pointer;';

        button.addEventListener('click', function () {
          openCustomizeOverlay(config.customizeUrl, label);
        });

        addToCartBtn.parentNode.insertBefore(button, addToCartBtn.nextSibling);
      })
      .catch(function () {
        // Best-effort only — never surface a broken storefront experience.
      });
  } catch (err) {
    // Never let a storefront-page error surface from this widget.
  }
})();
`;
}
