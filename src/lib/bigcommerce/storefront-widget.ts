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
 * Every one of these is checked defensively; absence is always a silent
 * no-op, never a thrown error.
 *
 * Finding the product id: `BCData.product_attributes.id` is tried first,
 * but confirmed in production that at least one real theme's BCData omits
 * `id` entirely from `product_attributes` (only sku/weight/price/etc. are
 * present there). Falls back to the hidden `<input name="product_id">`
 * every Stencil add-to-cart form must submit regardless of theme — a more
 * fundamental, load-bearing convention than BCData's own optional shape,
 * since BigCommerce's cart endpoint has no other way to know which product
 * is being added.
 *
 * Finding the Add to Cart button: `#form-action-addToCart` (Cornerstone's
 * default id) is tried first as a fast path, but confirmed in production
 * that custom/Page-Builder-heavy themes often don't use it at all, and may
 * render the button client-side (mounted after this script already ran,
 * not present in the initial DOM). So this also falls back to scanning for
 * any button/submit-input/role="button" link whose visible text reads "add
 * to cart" (case-insensitive) — a much more theme-agnostic signal than any
 * specific id/class — and polls for it for a bounded window to tolerate
 * late client-side rendering, rather than only checking once. That scan is
 * scoped to the product_id input's own `<form>` (falling back to the whole
 * document only if no such form is found) — confirmed necessary in
 * production: a page with related-product carousels/upsell widgets can
 * have several other "Add to Cart" buttons elsewhere on the page, and an
 * unscoped whole-document text scan risks matching one of those instead of
 * the actual product form's button, silently inserting the Customize
 * button somewhere the merchant never sees.
 *
 * The product_id input (and therefore the form scope) is re-resolved from
 * `document` on every single check rather than captured once — confirmed
 * necessary in production on a React-rendered (Makeswift) storefront: the
 * framework replaces the entire product form with a new DOM subtree during
 * its own render pass, so a scope captured once early goes stale/detached
 * and every subsequent query against it silently returns nothing, even
 * though a live, matching button exists elsewhere in the (new) DOM the
 * whole time.
 *
 * Insertion is driven by a MutationObserver on `document.body`, not a
 * time-bounded poll — a React-rendered storefront can re-render (and
 * replace) the product form repeatedly over the page's lifetime, not just
 * once during initial load, so a poll that gives up after N seconds can
 * miss a button that only exists after that window, and — more subtly —
 * can't recover if a later re-render removes an already-inserted button.
 * The observer re-attempts insertion on every DOM mutation for as long as
 * the page is open; the "already inserted" marker-attribute check makes
 * repeated attempts a no-op once successful, so this is cheap and self-
 * healing rather than a busy-loop.
 *
 * DOM readiness: confirmed in production that BigCommerce doesn't reliably
 * honor the requested footer placement — the script can execute before the
 * product form has been parsed into the DOM at all, so every DOM-dependent
 * step (reading `product_id`, searching for the Add to Cart button) is
 * deferred to a `DOMContentLoaded` handler when the script runs while the
 * document is still loading, and only reads `document.currentScript`
 * synchronously up front — that reference goes stale (`null`) the instant
 * the classic script finishes executing, so it cannot itself be deferred.
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

    // Temporary, always-on diagnostic logging (prefixed so it's easy to spot
    // and easy to grep out later) — this widget has repeatedly failed
    // silently in production in ways that were only diagnosable by manually
    // re-running its own logic in the console after the fact, which doesn't
    // reveal *why* the real, first-pass execution came up empty. Safe to
    // remove once storefront compatibility across themes is no longer in
    // active development.
    function log(msg) {
      try {
        if (window.console && console.log) console.log('[Kickflip Customize]', msg);
      } catch (e) {
        // no-op
      }
    }

    function init() {
    try {
    log('init running, readyState=' + document.readyState);

    var productIdInput = document.querySelector('input[name="product_id"]');

    var bcData = window.BCData;
    var productId = bcData && bcData.product_attributes && bcData.product_attributes.id;
    if (!productId) {
      productId = productIdInput && productIdInput.value;
    }
    log('productId=' + productId + ' (input found=' + !!productIdInput + ', BCData.id=' + (bcData && bcData.product_attributes && bcData.product_attributes.id) + ')');
    if (!productId) {
      log('bailing: no productId resolved');
      return;
    }

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

    var ADD_TO_CART_TEXT = /add\\s*to\\s*cart/i;

    function findAddToCartAnchor() {
      var byId = document.getElementById('form-action-addToCart');
      if (byId) return byId;

      // Re-resolved on every call, not captured once — see the file-level
      // comment above on why a stale/detached scope silently finds nothing
      // forever on frameworks that replace the form's DOM subtree.
      var currentProductIdInput = document.querySelector('input[name="product_id"]');
      var scope = (currentProductIdInput && currentProductIdInput.closest('form')) || document;

      var candidates = scope.querySelectorAll(
        'button, input[type="submit"], input[type="button"], a[role="button"]',
      );
      for (var i = 0; i < candidates.length; i++) {
        var el = candidates[i];
        var text = el.tagName === 'INPUT' ? el.value : el.textContent;
        if (text && ADD_TO_CART_TEXT.test(text)) return el;
      }
      return null;
    }

    // Runs tryInsert immediately, then again on every DOM mutation for as
    // long as the page is open — see the file-level comment on why this
    // replaces a time-bounded poll. tryInsert must itself be idempotent
    // (safe to call repeatedly, a no-op once its target is already present).
    //
    // Watches characterData too, not just childList: confirmed in
    // production (via a direct, controlled reproduction of this exact
    // search against the live DOM) that the anchor-finding logic is
    // correct and the button is genuinely present with matching text
    // moments after load, yet the widget's own first-pass execution still
    // found nothing — pointing at a React update that changes the button's
    // label by mutating an existing text node in place (e.g. swapping a
    // loading state for final text) rather than by adding/removing
    // elements, which a childList-only observer never sees. A low-
    // frequency interval fallback runs alongside it as a second line of
    // defense, since this storefront has repeatedly done things standard
    // assumptions didn't cover.
    function keepEnsuring(tryInsert) {
      tryInsert();
      var observer = new MutationObserver(function () {
        tryInsert();
      });
      observer.observe(document.body, {
        childList: true,
        subtree: true,
        characterData: true,
        attributes: true,
      });
      setInterval(tryInsert, 2000);
    }

    // TEMPORARY, for diagnosing storefront/theme compatibility across
    // stores: always inserts a visibly-labeled test button next to the Add
    // to Cart button, independent of whether any product on the page
    // actually has Customize configured/enabled. Confirms the anchor-
    // finding mechanics work on a given theme in isolation from the
    // config-gated real button below. Safe to delete once storefront
    // compatibility is no longer in active development.
    keepEnsuring(function () {
      var anchor = findAddToCartAnchor();
      if (!anchor || !anchor.parentNode) return;
      if (document.querySelector('[data-kickflip-test-button]')) return;

      var testButton = document.createElement('button');
      testButton.type = 'button';
      testButton.setAttribute('data-kickflip-test-button', '');
      testButton.textContent = 'Kickflip test button (visible = widget works)';
      testButton.style.cssText =
        'display:block;width:100%;margin-top:0.5rem;padding:0.5rem 1rem;' +
        'font-size:0.8rem;font-weight:600;color:#fff;background:#e67e22;' +
        'border:none;border-radius:4px;cursor:pointer;';
      testButton.addEventListener('click', function () {
        window.alert('Kickflip widget script found the Add to Cart button and can insert content here.');
      });

      anchor.parentNode.insertBefore(testButton, anchor.nextSibling);
      log('TEST button: inserted');
    });

    fetch(configUrl, { method: 'GET' })
      .then(function (res) {
        return res && res.ok ? res.json() : null;
      })
      .then(function (config) {
        log('config response: ' + JSON.stringify(config));
        if (!config || !config.enabled || !config.customizeUrl) return;

        keepEnsuring(function () {
          var addToCartBtn = findAddToCartAnchor();
          log('real button attempt: anchorFound=' + !!addToCartBtn + ' alreadyInserted=' + !!document.querySelector('[data-kickflip-customize-button]'));
          if (!addToCartBtn || !addToCartBtn.parentNode) return;
          if (document.querySelector('[data-kickflip-customize-button]')) return;

          var label = config.buttonLabel || 'Customize';
          var button = document.createElement('button');
          button.type = 'button';
          button.setAttribute('data-kickflip-customize-button', '');
          button.textContent = label;
          button.style.cssText =
            'display:block;width:100%;margin-top:0.75rem;padding:0.75rem 1rem;' +
            'font-size:1rem;font-weight:600;color:#fff;background:#3c64f4;' +
            'border:none;border-radius:4px;cursor:pointer;';

          button.addEventListener('click', function () {
            openCustomizeOverlay(config.customizeUrl, label);
          });

          addToCartBtn.parentNode.insertBefore(button, addToCartBtn.nextSibling);
          log('Customize button: inserted');
        });
      })
      .catch(function (err) {
        log('config fetch FAILED: ' + err);
        // Best-effort only — never surface a broken storefront experience.
      });
    } catch (err) {
      // Never let a storefront-page error surface from this widget.
    }
    }

    if (document.readyState === 'loading') {
      document.addEventListener('DOMContentLoaded', init);
    } else {
      init();
    }
  } catch (err) {
    // Never let a storefront-page error surface from this widget.
  }
})();
`;
}
