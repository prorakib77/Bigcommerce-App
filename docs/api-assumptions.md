# API and environment assumptions

This app was built without access to Kickflip's official API reference documentation, and
several later features (the Products page's BigCommerce catalog search, the storefront Customize
button's Script Manager registration and storefront-theme conventions) were likewise built
against **assumed, unconfirmed shapes** rather than verified live documentation. Every assumption
below is explicitly flagged, isolated behind a narrow boundary (a single adapter file, or a
single configurable env var), and designed to degrade gracefully — never crash — if wrong. Fix
the isolated boundary first if a real integration turns out to differ.

## Kickflip API

Everything in this subsection is an explicit, flagged **assumption** about the Kickflip API's
shape, built from the endpoint pattern given in the original project brief. It is deliberately
isolated behind `src/lib/kickflip/` so that if the real API differs, **only that directory needs
to change** — no other part of the app depends on Kickflip's raw response shape, only on the
normalized `NormalizedKickflipDesign` type.

## What is and isn't assumed

**Used (per the brief, treated as documented):**

```text
GET /designs?cursor=<cursor>&limit=<limit>&sortOrder=descending&sortKey=designId
```

Authentication:

```text
Authorization: Bearer <token>
X-TENANT-ID: <tenant-id>
Accept: application/json
```

**Assumed, flagged explicitly (not given in the brief, inferred as the natural REST extension of
the endpoint above):**

```text
GET /designs/{designId}
```

used by `KickflipClient.getDesign()` (`src/lib/kickflip/client.ts`) to fetch a single design for
the preview drawer and for a retry/reconcile job that only has a design ID. If this route doesn't
exist or 404s, the client falls back to scanning the first page of `/designs` for a matching ID —
so the feature degrades gracefully rather than breaking outright, but this fallback won't find a
design outside the first page. **This is the one assumption most likely to need correcting once
real API docs are available.**

**Explicitly NOT used, per the brief's own constraint against reverse-engineering:**

- Any `/products` endpoint
- Any live customizer/storefront-builder endpoint
- Any endpoint not derivable from the `/designs` collection pattern above

## Response shape — confirmed against the real API (2026-08-02)

### List envelope (`kickflipDesignsResponseSchema`, `src/lib/kickflip/schemas.ts`)

**No longer just an assumption** — tested directly against `https://api.gokickflip.com/v1/designs`
with a real, authenticated token. The real envelope is index/offset-based, not the cursor-token
shape originally assumed from the brief:

```jsonc
{
  "pagination": {
    "collectionSize": 0,
    "resultSize": 0,
    "lastIndex": 0,
    "sortOrder": "descending",
    "sortKey": "designId"
  },
  "results": []
}
```

`results` (not `data`) is the array of raw design records. `pagination.lastIndex` /
`collectionSize` / `resultSize` describe an offset scheme rather than an opaque cursor token —
`src/lib/kickflip/client.ts`'s `deriveNextCursor()` treats `lastIndex + 1` as the next page's
offset (sent back as the `cursor` query param, same param name the brief specified).

**Still an open item**: the only real account tested so far had zero saved designs, so this
pagination derivation is confirmed correct for the empty case but **not yet verified against a
populated multi-page response** — re-check `deriveNextCursor()` once real design data exists.

The old assumed shapes (`{ data, cursor, hasMore }` / `{ data, meta: { cursor } }`) are kept as
tolerated fallbacks in `kickflipDesignsResponseSchema` in case a different account/endpoint
variant still returns them, but they are not what this API actually returns.

### Design record (`rawKickflipDesignSchema`)

```jsonc
{
  "designId": "string-or-number", // required — the only hard requirement
  "productId": "string-or-number", // optional
  "customizerProductId": "string-or-number", // optional
  "name": "string", // optional, falls back to "Kickflip design {id}"
  "price": "string-or-number", // required for a design to be importable
  "currency": "string", // optional; also accepts "currencyCode"
  "createdAt": "ISO-8601 string", // optional
  "updatedAt": "ISO-8601 string", // optional
  "images": ["url-string-or-{url}-object"], // optional
  "primaryImage": "url-string-or-{url}-object", // optional; falls back to images[0]
  "options": [{ "label": "string", "value": "string" }], // optional; becomes the summary
}
```

Everything else on the record is preserved as passthrough by the Zod schema (`.loose()`) but
never read by the mapper. A record failing this shape (most commonly: missing `designId` or
`price`, or a non-numeric `price`) is **skipped, not fatal** — `normalizeDesign()`
(`src/lib/kickflip/mapper.ts`) returns a discriminated `{ ok: false, reason }` result, and the
client (`listDesigns()`) collects these into a `skippedCount` rather than throwing, so one
malformed record never breaks the whole design list. See the `design-malformed-1` fixture in
`src/lib/kickflip/mock-client.ts` for exactly this case exercised in mock mode.

## How fixtures map to the schema

`src/lib/kickflip/mock-client.ts` generates ~24 synthetic designs matching the shape above, plus
one deliberately malformed record (`design-malformed-1`, missing `price`). These are used
whenever `MOCK_MODE=true`, and are what the Playwright E2E suite and several integration tests
run against. If you obtain real Kickflip API access and the actual shape differs from what's
documented here, update, in order:

1. `src/lib/kickflip/schemas.ts` — adjust `rawKickflipDesignSchema` /
   `kickflipDesignsResponseSchema` to match reality.
2. `src/lib/kickflip/mapper.ts` — adjust `normalizeDesign()` if field names/types changed.
3. `src/lib/kickflip/mock-client.ts` — update fixtures to match the corrected schema, so mock
   mode and tests stay representative.
4. `src/lib/kickflip/client.ts` — adjust the endpoint path/query params only if they differ from
   the assumed pattern.

Nothing outside `src/lib/kickflip/` should need to change — `NormalizedKickflipDesign`
(`src/lib/kickflip/types.ts`) is the stable contract the rest of the app (services, job handlers,
UI) depends on.

## Decimal-safe pricing

Prices are handled as strings end to end, never as JavaScript floating-point arithmetic. A raw
JSON number (if the API returns `price` as a number rather than a string) is formatted once via
`.toFixed(2)` immediately on ingestion — a single, non-arithmetic conversion — and never touched
again as a number until the single, direct `Number(design.price)` conversion at the BigCommerce
API request boundary (`src/lib/bigcommerce/catalog.ts`), which likewise performs no arithmetic.

## Currency handling

If a design has a `currencyCode` and it doesn't match the BigCommerce store's configured
currency (fetched via BigCommerce's V2 `/store` endpoint), the import is **blocked** with
`KICKFLIP_CURRENCY_MISMATCH` rather than silently converting. No conversion feature exists in
this release.

## Live configurator functionality — mostly still out of scope

Design *import* remains static-product-only: this app does not embed, proxy, or otherwise
integrate with the Kickflip configurator's actual logic. What changed with the Products page and
storefront Customize button (below) is narrower: a merchant-configured **button** that opens a
merchant-supplied URL in an iframe overlay. This app never inspects, validates, or knows what's
inside that iframe — see the README's
[Storefront Customize button](../README.md#storefront-customize-button) and
[Explicit exclusions](../README.md#explicit-exclusions).

## Kickflip customizer embed URL (`KICKFLIP_CUSTOMIZER_BASE_URL`)

**Assumed, not confirmed against real Kickflip customizer docs**: there is no verified
"customizer embed URL" pattern for Kickflip. `src/lib/kickflip/customizer-url.ts`'s
`buildKickflipCustomizerUrl()` takes a merchant/operator-configured **template** string
(`KICKFLIP_CUSTOMIZER_BASE_URL`, e.g. `https://customizer.gokickflip.com/embed/{customizerProductId}`)
and substitutes the literal token `{customizerProductId}` with the design's known
`kickflipCustomizerProductId` (already tracked on `ImportMapping`, sourced from Kickflip's raw
`customizerProductId` field). If the template is empty or doesn't contain the token, the function
returns `null` — no broken/static URL is ever suggested. This is a **suggestion only**: the
Products page's Customize URL field is always freely editable and never forced to match the
suggestion. Fix `KICKFLIP_CUSTOMIZER_BASE_URL` (an env var, not code) the moment the real embed
URL pattern is known.

## BigCommerce Scripts (Content) API

**Assumed, not confirmed against live BigCommerce docs this session**: `src/lib/bigcommerce/scripts.ts`
(`createScript`, `listScripts`) and `bcScriptSchema` (`src/lib/bigcommerce/schemas.ts`) assume the
`/content/scripts` V3 endpoint accepts/returns `{ uuid, name, src, kind: 'src', load_method,
location, visibility, auto_uninstall }`, and that write access requires the `store_v2_content`
OAuth scope (see the README's [OAuth scopes](../README.md#oauth-scopes) table). If the real shape
differs: only `scripts.ts` and `bcScriptSchema` need to change — `storefront-script-service.ts`
(the only caller) depends on the adapter's return type, not the raw response. If the scope name is
wrong, `ensureStorefrontScriptRegistered` fails loudly in logs (a `BIGCOMMERCE_AUTH_FAILED`/`403`-
shaped error) but never blocks install or a customize-config save — see that function's
`MOCK_MODE` gate and non-fatal call-site wrapping.

## Stencil/Cornerstone storefront conventions (storefront widget script)

`src/lib/bigcommerce/storefront-widget.ts` generates the JS served at
`GET /api/public/storefront/widget`, registered via Script Manager. It relies on three
storefront-environment conventions, **none formally guaranteed by BigCommerce for every theme**:

1. **`document.currentScript`** is available at the widget's top level — assumes Script Manager
   inserts a plain classic `<script src>` tag (not `async`/module), the typical default. Used to
   recover the `storeHash` baked into this script's own registered `src` query string.
2. **`window.BCData.product_attributes.id`** — a Stencil/Cornerstone convention exposing the
   current product's id on product pages. Absent on non-Cornerstone themes, headless/Catalyst
   storefronts, or non-product pages.
3. **`#form-action-addToCart`** — Cornerstone's Add to Cart button id, used as the insertion point
   for the Customize button. Best-effort only; other themes may use a different id or structure.

Every one of these is checked defensively (`if (!x) return;`); absence is always a silent no-op,
never a thrown error or a broken storefront page — see the full behavior description in
`storefront-widget.ts`'s file-level comment. If a merchant reports the button never appears,
check these three assumptions against their actual theme first, before assuming a bug elsewhere.

## BigCommerce Webhooks V3 API (Orders sync)

**Assumed, not confirmed against live BigCommerce docs this session**: `src/lib/bigcommerce/webhooks.ts`
(`createHook`, `listHooks`) and `bcHookSchema` (`src/lib/bigcommerce/schemas.ts`) assume the
`/hooks` V3 endpoint accepts/returns `{ id, scope, destination, is_active, headers }`, and that
write access requires the `store_v2_orders_read_only` OAuth scope (see the README's
[OAuth scopes](../README.md#oauth-scopes) table) being present on the store's authorized token —
same treatment as the Scripts-API assumption above. If the real shape differs, only `webhooks.ts`
and `bcHookSchema` need to change.

**The bigger assumption — webhook authenticity**: this app assumes BigCommerce webhook deliveries
carry **no cryptographic signature** (unlike, say, Shopify's HMAC header), and that the
documented mechanism for verifying a delivery's authenticity is the `headers` object supplied at
hook-creation time — a custom header (`x-kickflip-webhook-secret`,
`src/services/orders-webhook-service.ts::ORDERS_WEBHOOK_SECRET_HEADER`) whose value BigCommerce
is assumed to echo back verbatim on every delivery to that hook's destination URL. The webhook
receiver (`src/app/api/public/webhooks/bigcommerce/orders/route.ts`) compares this header in
constant time against a random per-store secret generated at registration
(`src/server/crypto/hash.ts::timingSafeEqualStrings`).

**Follow-up, if this is ever confirmed wrong or improvable**: if BigCommerce is later confirmed
to support HMAC-signed webhook deliveries (a signature computed over the raw body with a shared
secret, verifiable without a DB lookup), **prefer that over the static header** — it's strictly
stronger, since it lets the receiver reject a forged request before ever looking up the store or
touching the database, and it can't be replayed against a different payload the way a static
header technically could be (a leaked static header is valid for *any* body; an HMAC signature is
only valid for the exact body it was computed over). This app's actual exposure to a leaked
header is bounded regardless — see the "re-fetch, don't trust the payload" design in
`docs/architecture.md` and `SECURITY.md` — but HMAC would still be a strict improvement.

## Orders OAuth scope identifier

**Assumed, not confirmed**: `store_v2_orders_read_only` is this app's best-confidence guess at
the OAuth scope identifier BigCommerce returns when a merchant grants **Orders: Read-Only** in
the Developer Portal (paralleling the documented `store_v2_products`/`store_v2_products_read_only`
pair for the Products scope). If install starts failing on a scope mismatch after a merchant sets
Orders to Read-Only and reinstalls, this is the first place to check — fix in one place
(`BIGCOMMERCE_APP_SCOPES`'s default in `src/server/env/schema.ts`).
