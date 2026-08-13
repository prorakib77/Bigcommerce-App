# Kickflip → BigCommerce Product Importer

A single-click BigCommerce embedded app that connects to the Kickflip API and imports saved
Kickflip designs into the BigCommerce product catalog as regular BigCommerce products.

This app also lets a merchant browse and edit **every** BigCommerce product in the store (not
just Kickflip-imported ones), and — as of the Products page and storefront Customize button — can
optionally show a live "Customize" iframe on the storefront. This is a deliberate, later
walk-back of this app's original "administrative importer only" scope; see
[Explicit exclusions](#explicit-exclusions) and
[Storefront Customize button](#storefront-customize-button) below for exactly what changed and
what didn't.

## Table of contents

- [Product overview](#product-overview)
- [Architecture](#architecture)
- [Feature list](#feature-list)
- [Explicit exclusions](#explicit-exclusions)
- [Technology stack](#technology-stack)
- [Repository structure](#repository-structure)
- [Local setup](#local-setup)
- [Environment variables](#environment-variables)
- [PostgreSQL setup](#postgresql-setup)
- [BigCommerce draft-app setup](#bigcommerce-draft-app-setup)
- [OAuth scopes](#oauth-scopes)
- [Storefront Customize button](#storefront-customize-button)
- [Orders sync](#orders-sync)
- [Multiple-user configuration](#multiple-user-configuration)
- [Kickflip token & tenant setup](#kickflip-token--tenant-setup)
- [Mock mode](#mock-mode)
- [Running the web and worker processes](#running-the-web-and-worker-processes)
- [Migrations](#migrations)
- [Testing](#testing)
- [Deployment to Render](#deployment-to-render)
- [Production checklist](#production-checklist)
- [Secret rotation](#secret-rotation)
- [Troubleshooting](#troubleshooting)
- [Rate-limit behavior](#rate-limit-behavior)
- [Image-host allowlist](#image-host-allowlist)
- [Uninstall behavior](#uninstall-behavior)
- [Data retention](#data-retention)
- [Known API assumptions](#known-api-assumptions)

## Product overview

1. A merchant installs the app in BigCommerce via OAuth.
2. The app opens embedded inside the BigCommerce control panel iframe.
3. The merchant connects a Kickflip account (tenant ID + API token).
4. The merchant browses paginated saved Kickflip designs, previews one, picks a category and
   import settings, and imports one or several designs.
5. Imports run through a durable, resumable background job queue.
6. Each Kickflip design becomes a BigCommerce product (hidden by default for review), with
   images and private traceability metadata.
7. The app prevents duplicate products, supports re-importing changed designs, and gives the
   merchant import history with retry/cancel controls.

## Architecture

```mermaid
flowchart LR
    subgraph BigCommerce
        BCPanel[Control Panel iframe]
        BCApi[BigCommerce V3 Catalog API]
    end

    subgraph Kickflip
        KFApi[Kickflip API]
    end

    subgraph "This app"
        Web[Web process<br/>Next.js App Router]
        Worker[Worker process<br/>pg-boss job handlers]
        DB[(PostgreSQL<br/>stores, mappings,<br/>import runs, pg-boss queue)]
    end

    BCPanel <-- "iframe + bearer session" --> Web
    Web -- "OAuth + callbacks" --> BCApi
    Web -- "enqueue jobs" --> DB
    Worker -- "dequeue jobs" --> DB
    Worker -- "fetch designs" --> KFApi
    Worker -- "create/update products,<br/>images, metafields" --> BCApi
    Web -- "read/write" --> DB
```

The **web** process serves the embedded UI, BigCommerce OAuth/callback routes, and the
authenticated `/api/v1/*` API. The **worker** process durably processes import jobs. Both are
independently deployable from this one repository and share the same PostgreSQL database.

See [`docs/architecture.md`](docs/architecture.md) for a deeper walkthrough (session bootstrap
flow, job stage machine, idempotency guarantees).

## Feature list

- BigCommerce OAuth install/load/uninstall/remove-user callbacks with full JWT verification
- Multi-user support (store owner vs. authorized staff, least-privilege for credential changes)
- Short-lived, revocable, in-memory-only internal sessions (no iframe cookie dependency)
- Encrypted-at-rest BigCommerce and Kickflip credentials (AES-256-GCM, versioned envelope)
- Paginated Kickflip design browser with preview, search (client-side, current page), and
  batch selection
- Durable, resumable import pipeline (PostgreSQL-backed queue via `pg-boss`)
- Duplicate-prevention via a database unique constraint (one product per design per store)
- Change detection via a deterministic content fingerprint — re-imports update, not duplicate
- Partial-failure handling (e.g. a bad image never blocks product creation) with per-stage retry
- Orphaned-mapping detection (product deleted in BigCommerce) with an explicit, opt-in
  "Recreate product" recovery action
- SSRF-hardened image ingestion: HTTPS + allowlisted hosts only, DNS-rebinding protection,
  redirect re-validation, byte caps, magic-byte content-type sniffing
- Private, app-owned BigCommerce metafields for traceability (never exposed to the storefront)
- Import history with status filters, per-run stage/error detail, retry, and cancel
- Structured JSON logging with secret redaction; audit log for sensitive actions
- Development mock mode with deterministic fixtures and simulated failure scenarios
- A Products page listing and editing **every** BigCommerce product (name, price, description,
  visibility) — not limited to products this app imported
- A per-product "Customize" iframe URL, optionally auto-suggested from a Kickflip-imported
  product's customizer link, editable for any product
- An auto-injected storefront "Customize" button (below Add to Cart) that opens the configured
  iframe, registered via BigCommerce Script Manager at install time — see
  [Storefront Customize button](#storefront-customize-button)
- An Orders page that syncs BigCommerce orders in near-real-time via a webhook (view-only, no
  order-status updates from this app), plus a manual "Sync now" fallback — see
  [Orders sync](#orders-sync)

## Explicit exclusions

This release deliberately does **not** implement (see [`docs/api-assumptions.md`](docs/api-assumptions.md)
and the in-app Help page for more):

- **Partially walked back:** a full live Kickflip _configurator_ embedded inline on the
  storefront — what this app now does is a merchant-configured "Customize" **button** under Add
  to Cart that opens a merchant-supplied URL (which may or may not be a Kickflip customizer) in
  an iframe overlay. See [Storefront Customize button](#storefront-customize-button). This app
  still does not embed, proxy, or otherwise integrate with the Kickflip configurator itself —
  the iframe target is opaque to this app.
- **Partially walked back:** BigCommerce cart integration with the customizer — clicking Add to
  Cart _inside_ the Kickflip customizer now adds the product to the real BigCommerce cart with the
  chosen design, readable selection list, and Kickflip price adjustment attached to the order when
  the store has authorized the `store_cart` scope (see
  [Storefront Customize button](#storefront-customize-button)). What's still excluded: turning
  every Kickflip customization choice into a first-class BigCommerce variant.
- Live cart / "add to cart" / abandoned-cart activity tracking — explicitly deferred, out of
  scope for this release. Only _completed_ orders are synced; see [Orders sync](#orders-sync).
- **Partially walked back:** "Order synchronization or automatic fulfillment" — this app now
  syncs orders **in** (BigCommerce → this app, view-only, via webhook) for visibility. It still
  does **not** write anything back to BigCommerce's order data (no status updates, no automatic
  fulfillment) and does not sync anything **out**.
- Reverse-engineered/undocumented Kickflip dashboard or product-list endpoints
- Turning every Kickflip customization choice into a BigCommerce product variant
- Deleting BigCommerce products merely because a design disappears from Kickflip
- Automatic currency conversion (a currency mismatch blocks the import with a clear error)
- Marketplace billing

## Technology stack

| Concern          | Choice                                                                    |
| ---------------- | ------------------------------------------------------------------------- |
| Framework        | Next.js (App Router), React, strict TypeScript                            |
| Runtime          | Node.js 24 (Active LTS)                                                   |
| Package manager  | pnpm (exact versions pinned in `pnpm-lock.yaml`)                          |
| Database         | PostgreSQL, Prisma ORM (Prisma 7, driver-adapter model — see below)       |
| UI               | BigCommerce BigDesign components, styled-components                       |
| Validation       | Zod (env, request/response, external API schemas)                         |
| Logging          | Pino (structured JSON, field redaction)                                   |
| Job queue        | `pg-boss` (PostgreSQL-backed durable queue)                               |
| Testing          | Vitest (unit + integration), React Testing Library, Playwright (E2E), MSW |
| Lint/format      | ESLint (flat config), Prettier                                            |
| Containerization | Docker (multi-stage), Docker Compose (local Postgres)                     |
| CI               | GitHub Actions                                                            |
| Deployment       | Render (`render.yaml` blueprint: web + worker + PostgreSQL)               |

Exact pinned versions are in `package.json`/`pnpm-lock.yaml`. Two version notes worth knowing
if you touch dependencies:

- **Prisma 7** moved connection URLs out of `schema.prisma` and into `prisma.config.ts`
  (CLI-only), and the generated `PrismaClient` now requires an explicit driver adapter
  (`@prisma/adapter-pg`) rather than an implicit schema `url`. See `src/server/db/prisma.ts`
  and `prisma.config.ts`.
- **`pg-boss` is ESM-only** and requires Node ≥ 22.12. This repo runs entirely as ESM
  (`"type": "module"`); the worker process runs via `tsx` in both development and production
  (see [Running the web and worker processes](#running-the-web-and-worker-processes)) to avoid
  the `NodeNext`-resolution extension requirements that come with compiling ESM output directly.

## Repository structure

```text
src/
  app/                  Next.js App Router: pages + API routes
    api/bigcommerce/    OAuth callbacks (auth, load, uninstall, remove-user)
    api/v1/             Authenticated app API
    api/public/         Unauthenticated storefront/webhook-facing API (Customize widget + config,
                        BigCommerce Orders webhook receiver)
    health/             Liveness/readiness probes
    designs/ products/ orders/ imports/ settings/ help/   UI pages
  components/           React components (app-shell, dashboard, designs, products, orders, imports, settings, shared)
  server/               Cross-cutting server infra: auth, authorization, crypto, db, env,
                         errors, http, logging, rate-limit, session, validation
  lib/                  External adapters: bigcommerce/, kickflip/, images/
  services/             Business logic orchestration (connection, design, import, settings)
  jobs/                 pg-boss queue setup, worker entry point, job handlers
  repositories/         Prisma data-access layer (one file per aggregate)
  test/                 Test fixtures, factories, helpers, mocks
prisma/                 Schema, migrations, seed script
e2e/                    Playwright E2E tests, fixtures, seed script
docs/                   Deep-dive docs (see links throughout this README)
.github/workflows/      CI (lint/typecheck/test/build), CodeQL
Dockerfile              Multi-stage production image (shared by web + worker)
docker-compose.yml      Local PostgreSQL (dev + test instances)
render.yaml             Render deployment blueprint
```

## Local setup

Prerequisites: Node.js 24.x, pnpm (via Corepack), Docker.

```bash
corepack enable
pnpm install

# Start local PostgreSQL (dev + test instances)
docker compose up -d postgres
docker compose --profile test up -d postgres-test

cp .env.example .env
# Fill in MASTER_ENCRYPTION_KEY / APP_SESSION_SIGNING_KEY (see below), and either:
#  - real BigCommerce credentials from a draft app (see below), or
#  - MOCK_MODE=true to develop the UI without any real credentials

pnpm db:migrate
pnpm db:seed

pnpm dev            # web process, http://localhost:3000
pnpm worker:dev      # worker process, separate terminal
```

Generate the two required keys with:

```bash
openssl rand -base64 32   # MASTER_ENCRYPTION_KEY (must decode to exactly 32 bytes)
openssl rand -base64 48   # APP_SESSION_SIGNING_KEY (must decode to at least 32 bytes)
```

> **Note on local PostgreSQL ports:** `docker-compose.yml` maps the dev database to host port
> **5544** (not 5432) and the test database to **5545**. This sidesteps a real, non-obvious
> failure mode encountered while building this app: on Windows, a native PostgreSQL install
> already listening on `0.0.0.0:5432` silently intercepts `localhost:5432` traffic meant for the
> Docker container (IPv4/IPv6 dual-stack binding lets both coexist), producing a confusing
> "password authentication failed" error that has nothing to do with the container's actual
> credentials. If you don't have anything else on 5432, feel free to remap.

## Environment variables

See [`.env.example`](.env.example) for the full list with inline documentation. All variables
are validated at startup with Zod (`src/server/env`) — the process refuses to boot on missing,
malformed, or (in production) placeholder/weak values. Store-specific secrets (BigCommerce
access tokens, Kickflip API tokens) are **never** environment variables — they're encrypted at
rest in PostgreSQL, per store.

## PostgreSQL setup

Local development uses the bundled `docker-compose.yml` (see [Local setup](#local-setup)).
For a from-scratch external Postgres instance, create a database and a role with privileges on
it, then point `DATABASE_URL` (pooled/runtime) and `DIRECT_DATABASE_URL` (unpooled, used only by
`prisma migrate`) at it. If you don't have a separate pooler, both can be the same value.

### Alternative: SQLite, no Docker/Postgres needed (local dev only)

Don't have Docker or want to skip a cloud Postgres account? Set `DATABASE_URL=file:./local.db` in
`.env` instead — the app automatically switches to a SQLite backend for local development. Run
once:

```bash
pnpm db:generate:sqlite
pnpm db:migrate:sqlite
```

then `pnpm dev` / `pnpm worker:dev` as normal. This is a local-dev-only path — production always
uses Postgres, and the app refuses to boot with a `file:` `DATABASE_URL` when
`NODE_ENV=production`. See [`docs/architecture.md`](docs/architecture.md#sqlite-local-dev-path)
for what's different under the hood (a hand-built job queue stands in for `pg-boss`, which is
Postgres-only) and exactly what guarantees that queue does and doesn't provide compared to
production.

## BigCommerce draft-app setup

1. In the [BigCommerce Developer Portal](https://devtools.bigcommerce.com/), create a new draft
   app.
2. Under **Technical**, set:
   - Auth callback: `https://<your-tunnel-or-domain>/api/bigcommerce/auth`
   - Load callback: `https://<your-tunnel-or-domain>/api/bigcommerce/load`
   - Uninstall callback: `https://<your-tunnel-or-domain>/api/bigcommerce/uninstall`
   - Remove-user callback: `https://<your-tunnel-or-domain>/api/bigcommerce/remove-user`
3. Under **OAuth Scopes**, request **Products: Modify** (`store_v2_products`), **Content**
   (`store_v2_content`), **Orders: Read-Only** (`store_v2_orders_read_only`), and
   **Carts: Modify** (`store_cart`) — see [OAuth scopes](#oauth-scopes).
4. Copy the generated Client ID and Client Secret into `BIGCOMMERCE_CLIENT_ID` /
   `BIGCOMMERCE_CLIENT_SECRET`.
5. Install the draft app on a BigCommerce sandbox/dev store.

BigCommerce requires HTTPS callback URLs even in development. Use an HTTPS tunnel (e.g. `ngrok
http 3000`, or Cloudflare Tunnel) and set `APP_BASE_URL` and all four callback URLs to the
tunnel's HTTPS origin.

## OAuth scopes

| Scope                                               | Why it's needed                                                                                                                                                                                                                                                                                                                                      |
| --------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `store_v2_products` (**Products: Modify**)          | Create and update the BigCommerce products, images, and metafields this app generates from Kickflip designs, plus the Products page's browse/edit-any-product feature.                                                                                                                                                                               |
| `store_v2_content` (**Content**)                    | Registers the storefront Customize-button script via BigCommerce Script Manager (`/content/scripts`) — see [Storefront Customize button](#storefront-customize-button). **FLAG:** this exact scope identifier is an unverified assumption, not confirmed against the live BigCommerce Developer Portal this session — see `docs/api-assumptions.md`. |
| `store_v2_orders_read_only` (**Orders: Read-Only**) | Reads order data (via the webhook receiver and the manual "Sync now" pull) to populate the Orders page — see [Orders sync](#orders-sync). Deliberately Read-Only, not Modify: this app never writes order data back to BigCommerce. **FLAG:** this exact scope identifier is an unverified assumption — see `docs/api-assumptions.md`.               |
| `store_cart` (**Carts: Modify**)                    | Creates or updates BigCommerce carts from the storefront priced-cart relay so nonzero Kickflip price adjustments can be merged into the catalog product's `list_price`.                                                                                                                                                                              |

Only request a new scope with a one-line justification like the rows above, and update
`BIGCOMMERCE_APP_SCOPES` — don't request scopes speculatively.

## Storefront Customize button

Each product can have a **Customize URL** (an iframe target) configured on the app's Products
page. When enabled, a "Customize" button is auto-injected on that product's storefront page,
directly under Add to Cart; clicking it opens the configured URL in an overlay iframe.

- **Mechanism**: at install time (and, as a self-healing fallback, the first time any product's
  Customize config is saved), the app registers one small, dependency-free JavaScript file with
  BigCommerce Script Manager (`src/lib/bigcommerce/scripts.ts`,
  `src/services/storefront-script-service.ts`). No merchant theme edits are required.
- **Per-product config**: set from the Products page (`/products` in the app) — a manual
  "Customize URL" field, pre-filled with a suggestion derived from `KICKFLIP_CUSTOMIZER_BASE_URL`
  when the product happens to be a Kickflip import with a known customizer product id, but always
  overridable, and available for **any** product regardless of its origin.
- **What runs on the storefront**: `src/lib/bigcommerce/storefront-widget.ts` generates the
  widget script served at `GET /api/public/storefront/widget`. It reads the current product id
  from BigCommerce Stencil's `window.BCData.product_attributes.id` convention, fetches
  `GET /api/public/storefront/customize-config` (the only endpoint in this app with a CORS
  exception — see `SECURITY.md`), and — best-effort, Cornerstone-theme-specific — inserts the
  button after `#form-action-addToCart`. Every one of these environment assumptions is checked
  defensively; absence is always a silent no-op, never a broken storefront page. See
  `docs/api-assumptions.md` for the full list of flagged assumptions this mechanism makes.
- **Trust model**: the iframe `src` is whatever URL the merchant configured, with no `sandbox`
  attribute — the same trust level as any other embed a merchant could add themselves via Script
  Manager. This app does not vet, proxy, or restrict that URL.
- **Known limitation**: no reconciliation job re-verifies the script still exists on
  BigCommerce's side if a merchant manually deletes it from Script Manager — a deliberate scope
  cut (see `docs/api-assumptions.md`).
- **Real cart integration (Kickflip customizer only)**: when the customizer iframe fires
  Kickflip's own `mczrAddToCart` postMessage event, the widget script adds the product to the
  shopper's real BigCommerce cart and continues to checkout normally. Zero-price customizations use
  the same-origin Storefront Cart API. Nonzero Kickflip price adjustments go through this app's
  public priced-cart relay, which uses the BigCommerce Management Cart API to set the merged unit
  `list_price` (`BigCommerce product price + Kickflip adjustment`). The specific design chosen is
  attached via a hidden, auto-registered BigCommerce Product Modifier (`kickflipModifierId` on
  `ProductCustomizeConfig`), and the shopper-readable Kickflip selections are attached through a
  second text modifier (`kickflipSummaryModifierId`) so the cart/order shows a normal line-item
  option list such as `Skin Tones: Yellow`.
- **Native purchase controls**: on products where the iframe/customizer is configured and enabled,
  the widget hides the native BigCommerce quantity selector and Add to Cart button so shoppers use
  the Customize button flow.

## Orders sync

Completed BigCommerce orders sync into this app's Orders page (`/orders`) automatically, near
real-time, so a merchant can see order activity without leaving this app.

- **Mechanism**: at install time (and, as a self-healing fallback, the first time "Sync now" is
  used with no webhook yet registered), the app registers a BigCommerce webhook for
  `store/order/created` (`src/lib/bigcommerce/webhooks.ts`,
  `src/services/orders-webhook-service.ts`). When BigCommerce delivers the webhook, the app
  **never trusts the delivered payload as authoritative** — it re-fetches the order from
  BigCommerce's own Orders API using the store's real access token before writing anything (see
  `SECURITY.md`), then caches a summary (customer, total, status, item count) locally.
- **Authenticity**: BigCommerce webhooks are assumed to carry no cryptographic signature; this
  app authenticates deliveries with a random per-store secret set as a custom header at
  registration time, compared in constant time on receipt. **FLAG:** unverified assumption about
  BigCommerce's webhook auth mechanism — see `docs/api-assumptions.md` (which also notes: prefer
  HMAC-signed deliveries over this static header, if BigCommerce is later confirmed to support
  them).
- **Manual "Sync now"**: pulls the most recent orders directly from BigCommerce. This is also the
  **only** way to fill in orders placed before the webhook was registered — there is no
  historical backfill beyond this bounded, recent-orders pull. A deliberate scope limitation.
- **View-only**: this app never writes order data back to BigCommerce — no status updates, no
  fulfillment actions. See [Explicit exclusions](#explicit-exclusions).
- **Not included**: live cart / "add to cart" activity, and abandoned-cart tracking — only
  _completed_ orders are synced. See [Explicit exclusions](#explicit-exclusions).

## Multiple-user configuration

Multi-user support is on by default — no separate toggle. The BigCommerce load callback JWT
includes both the acting `user` and the store `owner`; the app compares them to assign `OWNER`
or `USER` on every load, and provisions a `StoreUser` row the first time a given BigCommerce
user is seen. Only `OWNER` may change the Kickflip connection or import default settings
(`src/server/authorization`). A user removed via BigCommerce's "remove user" action is marked
inactive and their sessions are revoked; the store installation itself is unaffected.

## Kickflip token & tenant setup

See the in-app **Help** page for merchant-facing instructions. Summary: generate a Kickflip API
token scoped to read-only access to saved designs (this app never needs write access to
Kickflip), and find the tenant ID in Kickflip account/organization settings. Enter both on the
**Settings** page — the app tests the connection before saving.

## Mock mode

Set `MOCK_MODE=true` (development only — the app refuses to boot with it set in production) to
develop against deterministic local fixtures instead of real Kickflip/BigCommerce APIs:

- `src/lib/kickflip/mock-client.ts` — ~24 fixture designs, cursor pagination, one deliberately
  malformed record. Special tenant IDs simulate specific failures: `mock-expired-auth`,
  `mock-rate-limited`, `mock-server-error`.
- `src/lib/bigcommerce/catalog-service.ts` (`MockCatalogService`) — in-memory BigCommerce
  simulator. A product whose SKU contains `PARTIALSIM` fails its first metafield write (then
  succeeds on retry), exercising the partial-import/resume path.

A yellow development banner renders in the app shell whenever mock mode is active.

## Running the web and worker processes

```bash
pnpm dev            # web (Next.js dev server)
pnpm worker:dev      # worker (tsx --watch)

pnpm build           # production build (web)
pnpm start            # production web server
pnpm worker:start      # production worker (also via tsx — see the version note above)
```

## Migrations

```bash
pnpm db:migrate        # prisma migrate dev (local, interactive)
pnpm db:migrate:deploy # prisma migrate deploy (CI/production, non-interactive)
pnpm db:seed            # seeds one mock-mode-friendly dev store
pnpm db:studio           # Prisma Studio
```

## Testing

```bash
pnpm test              # unit tests (Vitest, no external services)
pnpm test:integration  # integration tests (real Postgres + MSW-mocked HTTP)
pnpm test:e2e           # Playwright E2E (spins up web + worker + a dedicated test DB)
pnpm verify              # format:check + lint + typecheck + test + build
```

Integration tests need the `postgres-test` compose service running and migrated:

```bash
docker compose --profile test up -d postgres-test
TEST_DATABASE_URL=postgresql://kickflip_app_test:changeme@localhost:5545/kickflip_app_test?schema=public \
  pnpm exec prisma migrate deploy
TEST_DATABASE_URL=postgresql://kickflip_app_test:changeme@localhost:5545/kickflip_app_test?schema=public \
  pnpm test:integration
```

CI runs all of the above (see `.github/workflows/ci.yml`) with **no real BigCommerce or Kickflip
credentials** — everything is mock mode, MSW, or a disposable Postgres service container.

## Deployment to Render

See [`docs/deployment-runbook.md`](docs/deployment-runbook.md) for the full walkthrough.
Summary: `render.yaml` defines a web service, a worker background service, and a managed
PostgreSQL database. Deploy with the Render Blueprint flow, then set the `sync: false` secret
env vars (BigCommerce credentials, encryption keys, `APP_BASE_URL`, callback URLs) in the
dashboard — never in the YAML. `preDeployCommand: pnpm prisma migrate deploy` runs migrations
before each deploy is promoted.

Production BigCommerce callback URLs, once `APP_BASE_URL` is set to your Render domain:

```text
https://<production-domain>/api/bigcommerce/auth
https://<production-domain>/api/bigcommerce/load
https://<production-domain>/api/bigcommerce/uninstall
https://<production-domain>/api/bigcommerce/remove-user
```

## Production checklist

- [ ] Real, unique `MASTER_ENCRYPTION_KEY` and `APP_SESSION_SIGNING_KEY` (never reused from dev)
- [ ] `MOCK_MODE` unset or `false` (the app refuses to boot otherwise in production)
- [ ] `APP_BASE_URL` and all four callback URLs use `https://` and match the deployed domain
- [ ] BigCommerce Developer Portal callback URLs match exactly
- [ ] `KICKFLIP_ALLOWED_IMAGE_HOSTS` lists only real, trusted Kickflip/CDN hostnames
- [ ] Database backups configured on the managed Postgres instance
- [ ] `pnpm verify` and `pnpm test:integration` pass against a clean environment
- [ ] Web service health check path (`/health/live`) configured and green
- [ ] Worker service running and processing a smoke-test import
- [ ] Sentry/OTel configured if desired (optional — app works without either)

## Secret rotation

See [`docs/token-rotation.md`](docs/token-rotation.md). Summary: BigCommerce access tokens
rotate naturally on reinstall; Kickflip tokens rotate via the Settings page (test → encrypt →
transactional save → audit event); `MASTER_ENCRYPTION_KEY`/`APP_SESSION_SIGNING_KEY` rotation
requires a coordinated re-encryption pass (documented, not yet automated — see the doc for why).

## Troubleshooting

| Symptom                                                                                        | Likely cause                                                                                                                                           |
| ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| App boots then immediately crashes with an env validation error                                | A required var is missing/malformed, or (in production) a placeholder value was left in place. The error message names the exact field.                |
| "password authentication failed" against local Postgres, but `docker exec ... psql` works fine | Something else (often a native PostgreSQL install) is already bound to port 5432 on the host — see the note in [Local setup](#local-setup).            |
| BigCommerce shows a blank/error page after clicking "Install"                                  | Check the web process logs for the `bigcommerce.auth` route — usually a scope or callback URL mismatch between the Developer Portal config and `.env`. |
| Import stuck in `QUEUED` forever                                                               | The worker process (`pnpm worker:dev` / `pnpm worker:start`) isn't running.                                                                            |
| Kickflip connection test fails                                                                 | Verify tenant ID and token against Kickflip directly; check `KICKFLIP_API_BASE_URL`.                                                                   |
| Image never imports, error `IMAGE_HOST_NOT_ALLOWED`                                            | Add the image's real hostname to `KICKFLIP_ALLOWED_IMAGE_HOSTS`.                                                                                       |

## Rate-limit behavior

Both external clients (`src/lib/kickflip/client.ts`, `src/lib/bigcommerce/client.ts`) retry
transient network errors and `429`/selected `5xx` responses with exponential backoff and full
jitter, up to a bounded attempt count — never a tight loop. For BigCommerce specifically, the
client reads the `X-Rate-Limit-Time-Reset-Ms` header and waits at least that long (plus jitter)
before retrying (`src/server/http/backoff.ts`, `computeRateLimitWaitMs`). Sensitive internal
endpoints (credential test/save, session bootstrap) are separately rate-limited per store/IP via
`src/server/rate-limit` — an in-memory limiter, sufficient for the single-instance Render
starter deployment this app targets; note in
[`docs/deployment-runbook.md`](docs/deployment-runbook.md) if you scale the web service out.

## Image-host allowlist

`KICKFLIP_ALLOWED_IMAGE_HOSTS` is a comma-separated, exact-match hostname allowlist (no implicit
subdomain trust). Every design image URL is checked against it before any network request is
made. See [`SECURITY.md`](SECURITY.md#image-ingestion--ssrf-protection) for the full SSRF
threat model.

## Uninstall behavior

Uninstalling immediately deactivates the store, revokes all sessions, and cancels queued (not
yet started) imports. It **never deletes BigCommerce products**. Import mappings and audit
history are preserved for `DATA_RETENTION_DAYS` (default 365) in case of reinstall. See
[Data retention](#data-retention) and `SECURITY.md`.

## Data retention

| Data                                           | Retention                                                         |
| ---------------------------------------------- | ----------------------------------------------------------------- |
| Encrypted Kickflip API token                   | Cleared immediately on disconnect or uninstall                    |
| Encrypted BigCommerce access token             | Retained (inactive store) until reinstall or manual deletion      |
| Import mappings, import run history, audit log | `DATA_RETENTION_DAYS` after uninstall (default 365), configurable |
| BigCommerce products created by this app       | Never deleted by this app, under any circumstance                 |

## Known API assumptions

This app is built against a **documented endpoint shape it assumes**, not a reverse-engineered
one. See [`docs/api-assumptions.md`](docs/api-assumptions.md) for exactly which Kickflip
endpoints/fields are assumed, how the fixtures map to them, and how to update the adapter if the
real API differs — by design, only `src/lib/kickflip/*` should ever need to change.
