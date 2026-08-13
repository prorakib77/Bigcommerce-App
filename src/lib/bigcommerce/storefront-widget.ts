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
 *
 * Cart integration (FLAGGED, see docs/api-assumptions.md for the full
 * writeup on both of these):
 *  - Listens for Kickflip's own `mczrAddToCart` postMessage from inside the
 *    customizer iframe (confirmed against Kickflip's help docs, not a
 *    guess: https://help.gokickflip.com/en/articles/4586872-custom-integration)
 *    and rejects anything whose `event.origin` doesn't match the
 *    customizer's own origin — the one input-validation boundary this
 *    addition introduces.
 *  - Adds to the real BigCommerce cart via the client-side Storefront Cart
 *    API (`/api/storefront/carts`, camelCase body) when Kickflip reports no
 *    custom price. When Kickflip reports a nonzero price adjustment, the
 *    widget calls this app's backend priced-cart relay so the server can use
 *    BigCommerce's Management Cart API with `list_price`. The `designId` is
 *    attached via `optionSelections` on a Modifier auto-created per product
 *    (src/services/product-customize-service.ts::ensureDesignReferenceModifier)
 *    and then hidden from ordinary shoppers via `hideModifierField` below,
 *    using this exact store's own confirmed DOM convention
 *    (`id="attribute-{modifierId}"`) — best-effort; degrades to "field
 *    visible" rather than breaking anything if a different theme doesn't
 *    share that convention.
 *  - `GET /api/storefront/carts` confirmed live: when the shopper has no
 *    existing cart, it returns `200` with body `[]` (an empty array), not a
 *    `404` and not a single Cart object as originally assumed. Handled
 *    defensively by unwrapping an array if one comes back.
 *  - A product can carry its own merchant-configured required Modifier that
 *    has nothing to do with Kickflip (confirmed live: a required "Engraved
 *    text" field on a real product). `addToRealCart` used to submit only
 *    its own designId modifier, so BigCommerce rejected the *entire* add
 *    with a 422 ("This product requires modifier options") on any product
 *    with another required modifier. Fixed by `collectFormOptionSelections`,
 *    which reads every existing `attribute[N]` field already on the native
 *    Add to Cart form and forwards it alongside the designId modifier — the
 *    same fields the native button itself would have submitted.
 *  - That alone isn't enough when a required field is *empty* — the shopper
 *    never had a reason to fill in "Engraved text" while using the Kickflip
 *    overlay, so `collectFormOptionSelections` forwarding an empty value
 *    still gets a 422. `getRequiredOptionGroups`/`promptForMissingFields`
 *    close that gap: before calling the Cart API, `addToRealCart` checks for
 *    any other required attribute group that's still unfilled and, if any
 *    exist, renders a small inline form inside the overlay asking for those
 *    values, writes the answers back into the real underlying form fields,
 *    then retries. Confirmed live this session: this was the actual reason
 *    a real merchant's product ("Engraved text", required) kept failing
 *    even after the previous fix.
 *  - Kickflip-selected customization choices are sent through a second
 *    auto-created text Modifier (`summaryModifierId` in the public config).
 *    It is hidden on the product page like the design-reference field, but
 *    submitted with a readable `Label: Value` summary so the cart/order shows
 *    the selections as normal line-item option metadata.
 *  - On products with this iframe/customizer enabled, the native quantity
 *    selector and native Add to Cart button are hidden so shoppers enter the
 *    cart flow through the customizer.
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
    keepCartOptionDisplayFixed();

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

    // Adds the configured product to the real BigCommerce cart, attaching the
    // Kickflip designId via the auto-registered Modifier's optionSelections
    // when available. Uses the backend priced-cart relay when Kickflip reports
    // a nonzero price adjustment, otherwise keeps the same-origin Storefront
    // Cart API path.
    // Reads every existing attribute[N] field from the real Add to Cart
    // form (text/textarea/select/checked radio/checked checkbox) and turns
    // it into an optionSelections entry. Confirmed necessary in production:
    // a product can carry its own merchant-configured required Modifier
    // completely unrelated to Kickflip (e.g. a required "Engraved text"
    // field) — addToRealCart used to submit only its own designId modifier,
    // so BigCommerce rejected the whole add with a 422 ("This product
    // requires modifier options") on any product with another required
    // modifier. This makes the widget forward whatever the shopper already
    // entered on the page, the same way the native Add to Cart button would.
    var KICKFLIP_SUMMARY_MAX_LENGTH = 1000;

    function collectFormOptionSelections() {
      var selections = [];
      var currentProductIdInput = document.querySelector('input[name="product_id"]');
      var form = currentProductIdInput && currentProductIdInput.closest('form');
      if (!form) return selections;

      var seen = {};
      var fields = form.querySelectorAll('[name^="attribute["]');
      for (var i = 0; i < fields.length; i++) {
        var el = fields[i];
        var match = /^attribute\\[(\\d+)\\]/.exec(el.name || '');
        if (!match) continue;
        var optionId = parseInt(match[1], 10);

        if ((el.type === 'checkbox' || el.type === 'radio') && !el.checked) continue;
        if (seen[optionId]) continue;

        seen[optionId] = true;
        selections.push({ optionId: optionId, optionValue: el.value });
      }
      return selections;
    }

    function cleanSummaryText(value) {
      if (value === undefined || value === null) return '';
      if (typeof value === 'number' || typeof value === 'boolean') return String(value);
      if (typeof value !== 'string') return '';
      return value.replace(/\\s+/g, ' ').trim();
    }

    function isInternalKickflipToken(value) {
      var normalized = cleanSummaryText(value)
        .toLowerCase()
        .replace(/[\\s_]+/g, '-');
      return /^(question|answer)-[a-z0-9]+$/.test(normalized);
    }

    function containsInternalKickflipToken(value) {
      return /\\b(?:QUESTION|ANSWER)[\\s_-]+[a-z0-9]+\\b/i.test(cleanSummaryText(value));
    }

    function getRawKeyQuestionLabel(value) {
      var match = /^key\\s*:\\s*(.+)$/i.exec(cleanSummaryText(value));
      return match ? cleanSummaryText(match[1]) : '';
    }

    function humanizeSummaryKey(key) {
      return cleanSummaryText(
        String(key)
          .replace(/[_-]+/g, ' ')
          .replace(/([a-z])([A-Z])/g, '$1 $2'),
      );
    }

    function isIgnoredSummaryKey(key) {
      var normalized = String(key || '').toLowerCase();
      return (
        isInternalKickflipToken(key) ||
        normalized === 'designid' ||
        normalized === 'price' ||
        normalized === 'quantity' ||
        normalized === 'productid' ||
        normalized === 'customizerproductid' ||
        normalized === 'variantid' ||
        normalized === 'sku' ||
        normalized === 'url' ||
        normalized.indexOf('image') !== -1 ||
        normalized.indexOf('thumbnail') !== -1 ||
        normalized.indexOf('preview') !== -1
      );
    }

    function isMediaLikeSummaryValue(value) {
      var text = cleanSummaryText(value).toLowerCase();
      return (
        text.indexOf('http://') === 0 ||
        text.indexOf('https://') === 0 ||
        text.indexOf('data:image') === 0
      );
    }

    function pickSummaryValue(obj, keys, allowEmpty) {
      for (var i = 0; i < keys.length; i++) {
        var value = obj && obj[keys[i]];
        if (value !== undefined && value !== null && (allowEmpty || value !== '')) return value;
      }
      return null;
    }

    function stringifySummaryValue(value) {
      if (value === undefined || value === null) return '';
      if (typeof value === 'string' || typeof value === 'number' || typeof value === 'boolean') {
        return cleanSummaryText(value);
      }
      if (Array.isArray(value)) {
        var parts = [];
        for (var i = 0; i < value.length; i++) {
          var part = stringifySummaryValue(value[i]);
          if (part) parts.push(part);
        }
        return parts.join(', ');
      }
      if (typeof value === 'object') {
        return cleanSummaryText(
          pickSummaryValue(value, [
            'label',
            'key',
            'name',
            'displayName',
            'title',
            'value',
            'valueName',
            'selectedValue',
            'selectedValueName',
            'text',
          ]),
        );
      }
      return '';
    }

    function buildKickflipSelectionSummary(detail) {
      try {
        if (!detail || typeof detail !== 'object') return '';

        var rows = [];
        var seenRows = {};

        function addRow(label, value) {
          var cleanLabel = cleanSummaryText(label);
          var cleanValue = cleanSummaryText(value);
          if (
            !cleanLabel ||
            /^key:?$/i.test(cleanLabel) ||
            isInternalKickflipToken(cleanLabel) ||
            containsInternalKickflipToken(cleanLabel)
          ) {
            return;
          }
          if (isMediaLikeSummaryValue(cleanValue) || containsInternalKickflipToken(cleanValue)) return;
          if (!cleanValue) cleanValue = 'Untitled answer';

          var row = cleanLabel.replace(/:$/, '') + ': ' + cleanValue;
          if (seenRows[row]) return;
          seenRows[row] = true;
          rows.push(row);
        }

        function addRawRow(row) {
          var cleanRow = cleanSummaryText(row);
          var rawKeyLabel = getRawKeyQuestionLabel(cleanRow);
          if (rawKeyLabel) {
            addRow(rawKeyLabel, '');
            return;
          }
          if (
            !cleanRow ||
            cleanRow.indexOf(':') === -1 ||
            /^key\\s*:/i.test(cleanRow) ||
            containsInternalKickflipToken(cleanRow)
          ) {
            return;
          }
          if (seenRows[cleanRow]) return;
          seenRows[cleanRow] = true;
          rows.push(cleanRow);
        }

        function appendPrimitive(value, label) {
          var text = cleanSummaryText(value);
          if (!text) return;
          if (label) {
            addRow(label, text);
            return;
          }

          var rawLines = String(value)
            .replace(/\\r\\n/g, '\\n')
            .replace(/\\r/g, '\\n')
            .split('\\n');
          for (var i = 0; i < rawLines.length; i++) {
            var line = cleanSummaryText(rawLines[i]);
            addRawRow(line);
          }
        }

        function appendValue(value, label, depth) {
          if (value === undefined || value === null || depth > 5) return;

          if (
            typeof value === 'string' ||
            typeof value === 'number' ||
            typeof value === 'boolean'
          ) {
            appendPrimitive(value, label);
            return;
          }

          if (Array.isArray(value)) {
            for (var i = 0; i < value.length; i++) {
              appendValue(value[i], label, depth + 1);
            }
            return;
          }

          if (typeof value !== 'object') return;

          var explicitLabel = stringifySummaryValue(
            pickSummaryValue(value, [
              'key',
              'label',
              'name',
              'displayName',
              'optionName',
              'groupName',
              'stepName',
              'category',
              'customization',
              'field',
              'group',
              'option',
              'title',
            ]),
          );
          var explicitValue = pickSummaryValue(value, [
            'selectedValue',
            'selectedValueName',
            'selected',
            'selectedChoice',
            'selection',
            'choice',
            'choiceName',
            'value',
            'valueName',
            'optionValue',
            'text',
          ], true);

          if (explicitLabel) {
            addRow(explicitLabel, explicitValue === null ? '' : stringifySummaryValue(explicitValue));
            return;
          }

          if (explicitValue !== null && label) {
            addRow(label, stringifySummaryValue(explicitValue));
            return;
          }

          var keys = Object.keys(value);
          for (var j = 0; j < keys.length; j++) {
            var key = keys[j];
            if (isIgnoredSummaryKey(key)) continue;
            appendValue(value[key], label || humanizeSummaryKey(key), depth + 1);
          }
        }

        var priorityKeys = [
          'summary',
          'productionData',
          'options',
          'selectedOptions',
          'selectedVariants',
          'selections',
          'variants',
          'choices',
          'items',
        ];
        for (var sourceIndex = 0; sourceIndex < priorityKeys.length && !rows.length; sourceIndex++) {
          var key = priorityKeys[sourceIndex];
          appendValue(detail[key], '', 0);
        }

        if (!rows.length) {
          Object.keys(detail).forEach(function (key) {
            if (isIgnoredSummaryKey(key)) return;
            appendValue(detail[key], humanizeSummaryKey(key), 0);
          });
        }

        var summary = rows.join('\\n');
        if (summary.length > KICKFLIP_SUMMARY_MAX_LENGTH) {
          summary = summary.slice(0, KICKFLIP_SUMMARY_MAX_LENGTH - 3).trim() + '...';
        }
        return summary;
      } catch (err) {
        log('buildKickflipSelectionSummary error: ' + err);
        return '';
      }
    }

    function isKickflipCartLabel(text, label) {
      return cleanSummaryText(text).toLowerCase() === label.toLowerCase() + ':';
    }

    function parseSelectionSummaryRows(text) {
      var rows = [];
      var seen = {};
      var lines = String(text || '')
        .replace(/\\r\\n/g, '\\n')
        .replace(/\\r/g, '\\n')
        .split('\\n');

      for (var i = 0; i < lines.length; i++) {
        var line = cleanSummaryText(lines[i]);
        var rawKeyLabel = getRawKeyQuestionLabel(line);
        if (
          rawKeyLabel &&
          !isInternalKickflipToken(rawKeyLabel) &&
          !containsInternalKickflipToken(rawKeyLabel)
        ) {
          var rawKeyRow = rawKeyLabel.replace(/:$/, '') + ': Untitled answer';
          if (!seen[rawKeyRow]) {
            seen[rawKeyRow] = true;
            rows.push(rawKeyRow);
          }
          continue;
        }
        if (
          !line ||
          line.indexOf(':') === -1 ||
          /^key\\s*:/i.test(line) ||
          containsInternalKickflipToken(line)
        ) {
          continue;
        }

        var separatorIndex = line.indexOf(':');
        var label = cleanSummaryText(line.slice(0, separatorIndex)).replace(/:$/, '');
        var value = cleanSummaryText(line.slice(separatorIndex + 1)) || 'Untitled answer';
        if (!label || isInternalKickflipToken(label) || containsInternalKickflipToken(label)) continue;

        var row = label + ': ' + value;
        if (seen[row]) continue;
        seen[row] = true;
        rows.push(row);
      }

      return rows;
    }

    function renderSelectionList(target, rows) {
      target.textContent = '';
      target.style.display = 'block';
      target.style.margin = '0';
      target.style.padding = '0';
      target.style.whiteSpace = 'normal';
      target.setAttribute('data-kickflip-selection-formatted', 'true');

      var list = document.createElement('div');
      list.setAttribute('data-kickflip-selection-list', 'true');
      list.style.cssText = 'display:block;margin:0;line-height:1.35;';

      for (var i = 0; i < rows.length; i++) {
        var row = document.createElement('div');
        row.textContent = rows[i];
        row.style.cssText = 'display:block;margin:0;';
        list.appendChild(row);
      }

      target.appendChild(list);
    }

    function formatCartKickflipOptions() {
      try {
        var labels = document.querySelectorAll('dl.cart-item-options dt');
        for (var i = 0; i < labels.length; i++) {
          var label = labels[i];
          var value = label.nextElementSibling;
          if (!value || value.tagName !== 'DD') continue;

          if (isKickflipCartLabel(label.textContent, 'Kickflip design reference')) {
            hideElement(label, 'data-kickflip-cart-hidden');
            hideElement(value, 'data-kickflip-cart-hidden');
            continue;
          }

          if (isKickflipCartLabel(label.textContent, 'Kickflip selected options')) {
            hideElement(label, 'data-kickflip-cart-hidden');
            if (value.getAttribute('data-kickflip-selection-formatted') === 'true') continue;
            var rows = parseSelectionSummaryRows(value.textContent);
            if (rows.length) renderSelectionList(value, rows);
          }
        }
      } catch (err) {
        // no-op - best-effort only.
      }
    }

    function keepCartOptionDisplayFixed() {
      keepEnsuring(formatCartKickflipOptions);
    }

    function withoutOptionSelection(selections, optionId) {
      if (!optionId) return selections;
      return selections.filter(function (sel) {
        return sel.optionId !== optionId;
      });
    }

    function parseMoney(value) {
      if (value === undefined || value === null || value === '') return null;
      if (typeof value === 'number') return Number.isFinite(value) ? value : null;
      if (typeof value === 'string') {
        var normalized = value.replace(/,/g, '').replace(/[^0-9.+-]/g, '').trim();
        if (!/^-?\\d+(\\.\\d{1,4})?$/.test(normalized)) return null;
        var parsed = Number(normalized);
        return Number.isFinite(parsed) ? parsed : null;
      }
      if (typeof value === 'object') {
        var keys = ['amount', 'price', 'value', 'total', 'totalPrice', 'adjustment'];
        for (var i = 0; i < keys.length; i++) {
          var nested = parseMoney(value[keys[i]]);
          if (nested !== null) return nested;
        }
      }
      return null;
    }

    function sumMoneyEntries(value) {
      if (!value) return null;
      var total = 0;
      var found = false;

      function visit(entry) {
        if (entry === undefined || entry === null) return;
        if (Array.isArray(entry)) {
          for (var i = 0; i < entry.length; i++) visit(entry[i]);
          return;
        }
        var amount = parseMoney(entry);
        if (amount !== null) {
          total += amount;
          found = true;
        }
      }

      visit(value);
      return found ? total : null;
    }

    function getKickflipPriceAdjustment(detail) {
      if (!detail || typeof detail !== 'object') return null;

      var directPrice = parseMoney(detail.price);
      if (directPrice !== null && Math.abs(directPrice) >= 0.005) return directPrice;

      var customExtraPrices = sumMoneyEntries(detail.customExtraPrices);
      if (customExtraPrices !== null && Math.abs(customExtraPrices) >= 0.005) {
        return customExtraPrices;
      }

      var pricing = detail.pricing || {};
      var pricingKeys = ['adjustment', 'priceAdjustment', 'extraPrice', 'extrasTotal', 'total'];
      for (var i = 0; i < pricingKeys.length; i++) {
        var candidate = parseMoney(pricing[pricingKeys[i]]);
        if (candidate !== null && Math.abs(candidate) >= 0.005) return candidate;
      }

      return directPrice;
    }

    function formatMoneyForRequest(value) {
      return (Math.round(value * 100) / 100).toFixed(2);
    }

    function getCurrentVariantId() {
      var selectors = [
        'input[name="variant_id"]',
        'input[name="variation_id"]',
        'select[name="variant_id"]',
        '[data-product-variant-id]',
      ];
      for (var i = 0; i < selectors.length; i++) {
        var el = document.querySelector(selectors[i]);
        if (!el) continue;
        var raw = el.value || el.getAttribute('data-product-variant-id');
        var parsed = parseInt(raw, 10);
        if (Number.isInteger(parsed) && parsed > 0) return parsed;
      }
      return null;
    }

    function getCurrentCart() {
      return fetch('/api/storefront/carts', { method: 'GET', credentials: 'include' })
        .then(function (res) {
          if (!res || res.status === 404) return null;
          return res.ok ? res.json() : null;
        })
        .then(function (body) {
          // Confirmed in production: a 200 with no existing cart returns an
          // empty array ([]), not a 404 and not a single Cart object as
          // originally assumed. Handle both an array and a bare object.
          return Array.isArray(body) ? body[0] || null : body;
        });
    }

    function addWithStorefrontCart(lineItem) {
      return getCurrentCart().then(function (cart) {
        if (cart && cart.id) {
          return fetch('/api/storefront/carts/' + cart.id + '/items', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lineItems: [lineItem] }),
          });
        }
        return fetch('/api/storefront/carts', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ lineItems: [lineItem] }),
        });
      });
    }

    function addWithPricedCart(lineItem, priceAdjustment) {
      return getCurrentCart().then(function (cart) {
        return fetch(APP_BASE_URL + '/api/public/storefront/priced-cart', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            storeHash: storeHash,
            productId: parseInt(productId, 10),
            variantId: getCurrentVariantId(),
            cartId: cart && cart.id ? cart.id : null,
            quantity: lineItem.quantity,
            kickflipPriceAdjustment: formatMoneyForRequest(priceAdjustment),
            optionSelections: lineItem.optionSelections || [],
          }),
        });
      });
    }

    // Finds every OTHER required attribute[N] group on the native form (not
    // the Kickflip metadata modifiers themselves), grouped by optionId so a
    // radio/checkbox set counts as one group rather than one per input.
    function getRequiredOptionGroups(ignoredModifierIds) {
      var currentProductIdInput = document.querySelector('input[name="product_id"]');
      var form = currentProductIdInput && currentProductIdInput.closest('form');
      if (!form) return [];

      var ignored = {};
      (ignoredModifierIds || []).forEach(function (id) {
        if (id) ignored[id] = true;
      });

      var groups = {};
      var order = [];
      var fields = form.querySelectorAll('[name^="attribute["]');
      for (var i = 0; i < fields.length; i++) {
        var el = fields[i];
        if (!el.required) continue;
        var match = /^attribute\\[(\\d+)\\]/.exec(el.name || '');
        if (!match) continue;
        var optionId = parseInt(match[1], 10);
        if (ignored[optionId]) continue;
        if (!groups[optionId]) {
          var wrapper = (el.closest && el.closest('.form-field')) || el.parentNode;
          var labelEl = wrapper && wrapper.querySelector && wrapper.querySelector('label');
          var labelText = labelEl ? labelEl.textContent.replace(/required/i, '').trim() : 'Option ' + optionId;
          groups[optionId] = { optionId: optionId, label: labelText, els: [] };
          order.push(optionId);
        }
        groups[optionId].els.push(el);
      }
      return order.map(function (id) {
        return groups[id];
      });
    }

    function isGroupFilled(group) {
      for (var i = 0; i < group.els.length; i++) {
        var el = group.els[i];
        if (el.type === 'checkbox' || el.type === 'radio') {
          if (el.checked) return true;
        } else if (el.value) {
          return true;
        }
      }
      return false;
    }

    // Renders a small inline form inside the overlay asking the shopper to
    // fill in whatever required field(s) BigCommerce needs that Kickflip's
    // own customizer never asks about (e.g. a merchant-configured "Engraved
    // text" field). Writes their answers back into the real, underlying
    // Add to Cart form fields (not just an internal copy), then re-runs the
    // cart-add. Never blocks silently — this is what actually makes "add to
    // cart from inside the customizer" possible for a product that has its
    // own required customization on top of Kickflip's.
    function promptForMissingFields(missingGroups, panel, showStatus, onContinue) {
      try {
        var wrap = document.createElement('div');
        wrap.style.cssText =
          'position:absolute;left:0;right:0;bottom:0;max-height:70%;overflow:auto;' +
          'background:#fff;border-top:1px solid #ddd;padding:1rem;' +
          'font:400 0.9rem/1.4 system-ui,sans-serif;z-index:2;box-shadow:0 -4px 16px rgba(0,0,0,0.15);';

        var heading = document.createElement('div');
        heading.textContent = 'A couple more details are needed before this can be added to your cart:';
        heading.style.cssText = 'font-weight:600;margin-bottom:0.75rem;';
        wrap.appendChild(heading);

        var appliers = [];

        missingGroups.forEach(function (group) {
          var fieldWrap = document.createElement('div');
          fieldWrap.style.cssText = 'margin-bottom:0.75rem;';

          var labelNode = document.createElement('label');
          labelNode.textContent = group.label;
          labelNode.style.cssText = 'display:block;font-weight:600;margin-bottom:0.25rem;';
          fieldWrap.appendChild(labelNode);

          var sample = group.els[0];

          if (sample.tagName === 'SELECT') {
            var select = sample.cloneNode(true);
            select.removeAttribute('id');
            select.style.cssText = 'width:100%;padding:0.4rem;font-size:1rem;';
            fieldWrap.appendChild(select);
            appliers.push(function () {
              sample.value = select.value;
            });
          } else if (sample.type === 'radio' || sample.type === 'checkbox') {
            group.els.forEach(function (optEl) {
              var optWrapper = (optEl.closest && optEl.closest('label')) || optEl.parentNode;
              var optLabel = optWrapper ? optWrapper.textContent.trim() : optEl.value;
              var choiceLabel = document.createElement('label');
              choiceLabel.style.cssText = 'display:block;font-weight:400;margin-bottom:0.25rem;';
              var choiceInput = document.createElement('input');
              choiceInput.type = optEl.type;
              choiceInput.name = 'kickflip-missing-' + group.optionId;
              choiceLabel.appendChild(choiceInput);
              choiceLabel.appendChild(document.createTextNode(' ' + optLabel));
              fieldWrap.appendChild(choiceLabel);
              appliers.push(function () {
                if (choiceInput.checked) optEl.checked = true;
              });
            });
          } else {
            var isTextarea = sample.tagName === 'TEXTAREA';
            var input = document.createElement(isTextarea ? 'textarea' : 'input');
            if (!isTextarea) input.type = sample.type || 'text';
            input.style.cssText = 'width:100%;padding:0.4rem;font-size:1rem;box-sizing:border-box;';
            fieldWrap.appendChild(input);
            appliers.push(function () {
              sample.value = input.value;
            });
          }

          wrap.appendChild(fieldWrap);
        });

        var continueBtn = document.createElement('button');
        continueBtn.type = 'button';
        continueBtn.textContent = 'Continue';
        continueBtn.style.cssText =
          'display:block;width:100%;padding:0.65rem 1rem;font-size:1rem;font-weight:600;' +
          'color:#fff;background:#3c64f4;border:none;border-radius:4px;cursor:pointer;';
        continueBtn.addEventListener('click', function () {
          appliers.forEach(function (apply) {
            try {
              apply();
            } catch (err) {
              // no-op — best-effort only.
            }
          });
          if (wrap.parentNode) wrap.parentNode.removeChild(wrap);
          onContinue();
        });
        wrap.appendChild(continueBtn);

        panel.appendChild(wrap);
      } catch (err) {
        log('promptForMissingFields error: ' + err);
        showStatus(
          'Could not add to cart automatically. Please close this window and use the Add to Cart button.',
          true,
        );
      }
    }

    function addToRealCart(detail, modifierId, summaryModifierId, showStatus, panel) {
      var missingGroups = getRequiredOptionGroups([modifierId, summaryModifierId]).filter(function (g) {
        return !isGroupFilled(g);
      });

      if (missingGroups.length) {
        promptForMissingFields(missingGroups, panel, showStatus, function () {
          addToRealCart(detail, modifierId, summaryModifierId, showStatus, panel);
        });
        return;
      }

      var qtyInput = document.querySelector('input[name="qty[]"]');
      var quantity = (qtyInput && parseInt(qtyInput.value, 10)) || 1;

      var optionSelections = collectFormOptionSelections();
      if (modifierId && detail && detail.designId !== undefined && detail.designId !== null) {
        optionSelections = withoutOptionSelection(optionSelections, modifierId);
        optionSelections.push({ optionId: modifierId, optionValue: String(detail.designId) });
      }
      var selectionSummary = buildKickflipSelectionSummary(detail);
      if (summaryModifierId && selectionSummary) {
        optionSelections = withoutOptionSelection(optionSelections, summaryModifierId);
        optionSelections.push({ optionId: summaryModifierId, optionValue: selectionSummary });
      }

      var lineItem = { productId: productId, quantity: quantity };
      if (optionSelections.length) lineItem.optionSelections = optionSelections;

      showStatus('Adding to cart…', false);

      var priceAdjustment = getKickflipPriceAdjustment(detail);
      var cartRequest =
        priceAdjustment !== null && Math.abs(priceAdjustment) >= 0.005
          ? addWithPricedCart(lineItem, priceAdjustment)
          : addWithStorefrontCart(lineItem);

      cartRequest
        .then(function (res) {
          if (!res || !res.ok) {
            throw new Error('cart request failed, status=' + (res && res.status));
          }
          return res.json().catch(function () {
            return null;
          });
        })
        .then(function (body) {
          if (body && (body.id || body.data)) {
            return {
              ok: true,
              status: 200,
              kickflipRedirectUrl: body.data && body.data.cartUrl,
            };
          }
          // Confirmed in production: a 200 with no existing cart returns an
          // empty array ([]), not a 404 and not a single Cart object as
          // originally assumed — handle both an array and a bare object so
          // whichever shape a given store returns still resolves correctly.
          var cart = Array.isArray(body) ? body[0] : body;
          if (cart && cart.id) {
            return fetch('/api/storefront/carts/' + cart.id + '/items', {
              method: 'POST',
              credentials: 'include',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({ lineItems: [lineItem] }),
            });
          }
          return fetch('/api/storefront/carts', {
            method: 'POST',
            credentials: 'include',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ lineItems: [lineItem] }),
          });
        })
        .then(function (res) {
          if (!res || !res.ok) {
            throw new Error('cart request failed, status=' + (res && res.status));
          }
          log('Added to cart via Kickflip design ' + (detail && detail.designId));
          showStatus('Added to cart! Redirecting…', false);
          setTimeout(function () {
            window.location.href = res.kickflipRedirectUrl || '/cart.php';
          }, 900);
        })
        .catch(function (err) {
          log('addToRealCart FAILED: ' + err);
          showStatus(
            'Could not add to cart automatically. Please close this window and use the Add to Cart button.',
            true,
          );
        });
    }

    // Best-effort: hides the auto-registered design-reference Modifier field
    // from ordinary shoppers (it's filled by addToRealCart above, never by
    // hand). Uses this exact store's own confirmed rendering convention —
    // see the file-level comment. Idempotent and safe to call repeatedly.
    function hideModifierField(modifierId) {
      try {
        var field = document.getElementById('attribute-' + modifierId);
        if (!field) return;
        var wrapper = (field.closest && field.closest('.form-field')) || field;
        if (wrapper.getAttribute('data-kickflip-hidden') === 'true') return;
        wrapper.style.display = 'none';
        wrapper.setAttribute('data-kickflip-hidden', 'true');
      } catch (err) {
        // no-op - best-effort only.
      }
    }

    function hideElement(el, markerAttribute) {
      try {
        if (!el || el.getAttribute(markerAttribute) === 'true') return;
        el.style.display = 'none';
        el.setAttribute(markerAttribute, 'true');
      } catch (err) {
        // no-op - best-effort only.
      }
    }

    function hideQuantityControls() {
      try {
        var currentProductIdInput = document.querySelector('input[name="product_id"]');
        var form = currentProductIdInput && currentProductIdInput.closest('form');
        var scope = form || document;
        var qtyFields = scope.querySelectorAll(
          'input[name="qty[]"], input[name="quantity"], [data-quantity-control-input]',
        );

        for (var i = 0; i < qtyFields.length; i++) {
          var field = qtyFields[i];
          var wrapper =
            (field.closest &&
              (field.closest('.form-field-quantity-label') ||
                field.closest('.form-field--increments') ||
                field.closest('[data-quantity-control]') ||
                field.closest('.quantity') ||
                field.closest('.form-field'))) ||
            field;
          hideElement(wrapper, 'data-kickflip-native-quantity-hidden');
        }
      } catch (err) {
        // no-op - best-effort only.
      }
    }

    function getCustomizeInsertionPoint(addToCartBtn) {
      var purchaseContainer =
        addToCartBtn &&
        addToCartBtn.closest &&
        addToCartBtn.closest('[data-product-add], .form-action, .form-submit-container');
      if (purchaseContainer && purchaseContainer.parentNode) {
        return { parent: purchaseContainer.parentNode, before: purchaseContainer.nextSibling };
      }
      return { parent: addToCartBtn.parentNode, before: addToCartBtn.nextSibling };
    }

    function hideNativePurchaseControls(addToCartBtn) {
      hideQuantityControls();
      hideElement(addToCartBtn, 'data-kickflip-native-add-hidden');
    }

    function openCustomizeOverlay(url, label, modifierId, summaryModifierId) {
      var overlay = document.createElement('div');
      overlay.style.cssText =
        'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.6);' +
        'z-index:2147483000;display:flex;align-items:center;justify-content:center;padding:1.5rem;';

      var panel = document.createElement('div');
      panel.style.cssText =
        'position:relative;background:#fff;width:calc(100vw - 3rem);max-width:82rem;' +
        'height:92vh;max-height:calc(100vh - 3rem);' +
        'border-radius:8px;overflow:hidden;box-shadow:0 8px 32px rgba(0,0,0,0.35);';

      var closeBtn = document.createElement('button');
      closeBtn.type = 'button';
      closeBtn.setAttribute('aria-label', 'Close ' + (label || 'Customize'));
      closeBtn.textContent = String.fromCharCode(215);
      closeBtn.style.cssText =
        'position:absolute;top:0.5rem;right:0.5rem;width:2rem;height:2rem;border:none;' +
        'border-radius:50%;background:#fff;box-shadow:0 1px 4px rgba(0,0,0,0.3);' +
        'font-size:1.25rem;line-height:1;cursor:pointer;z-index:1;';

      var statusBar = document.createElement('div');
      statusBar.style.cssText =
        'position:absolute;left:0;right:0;bottom:0;padding:0.6rem 1rem;' +
        'font:600 0.85rem/1.3 system-ui,sans-serif;text-align:center;color:#fff;' +
        'display:none;z-index:1;';

      function showStatus(message, isError) {
        statusBar.textContent = message;
        statusBar.style.background = isError ? '#c0392b' : '#2c3e50';
        statusBar.style.display = 'block';
      }

      var iframe = document.createElement('iframe');
      iframe.src = url;
      iframe.style.cssText = 'width:100%;height:100%;border:0;display:block;';

      var customizerOrigin = null;
      try {
        customizerOrigin = new URL(url).origin;
      } catch (e) {
        // no-op — origin check below simply never matches, so no cart-add
        // ever fires; the overlay still works as a plain iframe viewer.
      }

      function onKickflipMessage(e) {
        try {
          if (!e.data || e.data.eventName !== 'mczrAddToCart') return;
          if (!customizerOrigin || e.origin !== customizerOrigin) return;
          addToRealCart(e.data.detail, modifierId, summaryModifierId, showStatus, panel);
        } catch (err) {
          log('onKickflipMessage error: ' + err);
        }
      }

      function onKeydown(e) {
        if (e.key === 'Escape') close();
      }
      function close() {
        if (overlay.parentNode) overlay.parentNode.removeChild(overlay);
        document.removeEventListener('keydown', onKeydown);
        window.removeEventListener('message', onKickflipMessage);
      }

      closeBtn.addEventListener('click', close);
      overlay.addEventListener('click', function (e) {
        if (e.target === overlay) close();
      });
      document.addEventListener('keydown', onKeydown);
      window.addEventListener('message', onKickflipMessage);

      panel.appendChild(closeBtn);
      panel.appendChild(iframe);
      panel.appendChild(statusBar);
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

    fetch(configUrl, { method: 'GET' })
      .then(function (res) {
        return res && res.ok ? res.json() : null;
      })
      .then(function (body) {
        // The API wraps its payload as { data: {...}, meta: {...} } — same
        // convention as every other route in this app — so the actual
        // enabled/customizeUrl/buttonLabel fields live under body.data, not
        // on body directly.
        var config = body && body.data;
        log('config response: ' + JSON.stringify(config));
        if (!config || !config.enabled || !config.customizeUrl) return;

        keepEnsuring(function () {
          if (config.modifierId) hideModifierField(config.modifierId);
          if (config.summaryModifierId) hideModifierField(config.summaryModifierId);

          var addToCartBtn = findAddToCartAnchor();
          if (!addToCartBtn || !addToCartBtn.parentNode) return;
          hideNativePurchaseControls(addToCartBtn);
          if (document.querySelector('[data-kickflip-customize-button]')) return;

          var insertionPoint = getCustomizeInsertionPoint(addToCartBtn);
          if (!insertionPoint.parent) return;

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
            openCustomizeOverlay(config.customizeUrl, label, config.modifierId, config.summaryModifierId);
          });

          insertionPoint.parent.insertBefore(button, insertionPoint.before || null);
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
