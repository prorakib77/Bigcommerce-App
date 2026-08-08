# Architecture

See the README's [Architecture](../README.md#architecture) section for the high-level diagram.
This document goes deeper on three things that are easy to get wrong: the embedded-session
bootstrap flow, the import job stage machine, and the concurrency model.

## Embedded session bootstrap

BigCommerce embeds the app in an iframe inside its control panel and, on load, calls
`GET /api/bigcommerce/load` with a `signed_payload_jwt` query parameter. The app cannot rely on
third-party iframe cookies (increasingly blocked by browsers), so it needs another way to hand a
usable, revocable credential to the browser-side React app. The flow:

```mermaid
sequenceDiagram
    participant BC as BigCommerce
    participant Load as /api/bigcommerce/load
    participant DB as PostgreSQL
    participant Browser
    participant Bootstrap as /api/v1/session/bootstrap

    BC->>Load: GET ?signed_payload_jwt=...
    Load->>Load: verify JWT (sig, iss, exp, nbf)
    Load->>DB: resolve/provision store + user, role from owner claim
    Load->>DB: create OneTimeToken (60s TTL, single-use)
    Load-->>Browser: 302 redirect to /?bootstrap=<code>
    Browser->>Bootstrap: POST { code }
    Bootstrap->>DB: atomically consume the code (fails if reused/expired)
    Bootstrap->>DB: create AppSession row, sign short-lived JWT
    Bootstrap-->>Browser: { token, expiresAt } (JSON body, not the URL)
    Browser->>Browser: store token in memory only; strip ?bootstrap from URL/history
```

Why a one-time **code** instead of embedding the session token directly: the code travels through
a URL (browser history, possibly server logs) so it must never be the actual bearer credential.
It's single-use (enforced by an atomic conditional UPDATE, not a read-then-write, to close the
race an attacker replaying a captured URL would need) and expires in 60 seconds. The real session
token only ever appears in a JSON response body and in React state — never in a URL, a cookie, or
Web Storage. See `src/server/session/bootstrap.ts`, `src/components/app-shell/session-context.tsx`.

Every subsequent `/api/v1/*` call sends `Authorization: Bearer <token>`. The server re-verifies
the JWT signature/expiry on every request _and_ checks the live `AppSession` database row
(`src/server/session/index.ts`) — this is what makes revocation (uninstall, remove-user,
credential rotation) take effect immediately rather than waiting out the token's ~15 minute
lifetime.

## Storefront Customize widget registration (install-flow side effect)

After the `bigcommerce.auth` install transaction commits (`src/app/api/bigcommerce/auth/route.ts`),
the route makes one best-effort call to `ensureStorefrontScriptRegistered`
(`src/services/storefront-script-service.ts`), which registers the storefront Customize-button
script with BigCommerce Script Manager (`src/lib/bigcommerce/scripts.ts`) — see the README's
[Storefront Customize button](../README.md#storefront-customize-button).

This call is deliberately **non-fatal**: it's wrapped in its own try/catch that only logs a
warning, never fails the install response. Install is a synchronous, user-facing, mid-onboarding
flow — a transient BigCommerce hiccup registering a script must not block a merchant from
finishing installation. Self-healing works via a cached `Store.storefrontScriptUuid` column: if
it's already set, registration is skipped entirely (no network call); if install-time
registration failed, the next successful `PUT .../customize` (saving any product's Customize
config) retries the same call as a side effect
(`src/services/product-customize-service.ts::saveProductCustomizeConfig`) — so the widget
recovers automatically the first time it actually matters, without a dedicated retry job.

`ensureStorefrontScriptRegistered` also short-circuits immediately when `MOCK_MODE` is enabled —
required, not optional, since integration tests run with `MOCK_MODE=true` and MSW's
`onUnhandledRequest: 'error'` policy, which would otherwise fail on the first real, unmocked
Script Manager call this function would make.

## Orders webhook sync

The Orders page (`/orders`) is populated by a BigCommerce webhook rather than polling. The
registration side of this reuses the exact self-heal shape described above
(`src/services/orders-webhook-service.ts::ensureOrdersWebhookRegistered`, called from the same
install-flow site, non-fatal, cached-id-means-skip) — but with one deliberate difference from the
Script-registration precedent: it does **not** hard-skip everything under `MOCK_MODE`.

The reason: `ensureStorefrontScriptRegistered`'s `MOCK_MODE` short-circuit is safe because a fake
script UUID with no real script behind it is inert — nothing downstream depends on it being real.
`ensureOrdersWebhookRegistered`'s output is different in kind: the random secret it generates and
persists (`Store.ordersWebhookSecret`) **is** the authentication mechanism for a public,
unauthenticated endpoint. If the whole function were `MOCK_MODE`-gated, that secret would stay
`null` forever in the integration-test suite (which runs with `MOCK_MODE=true`), and the webhook
receiver's success path could only ever be tested via its 401 (bad-secret) branch, never its 200
(good-secret) branch. So only the actual outbound `createHook` network call is skipped under
`MOCK_MODE` (replaced with a sentinel id); the secret is always generated and persisted, giving
integration tests full parity with production on the part that actually matters.

**Re-fetch, don't trust the payload.** The webhook receiver
(`src/app/api/public/webhooks/bigcommerce/orders/route.ts`) treats the delivered webhook body as
nothing more than a trigger — `{ data: { type: 'order', id } }` — and never writes any field from
it directly. On a verified delivery, it calls back into BigCommerce's own Orders API
(`src/lib/bigcommerce/orders.ts::getOrder`, via `src/services/order-service.ts::syncOrderFromWebhook`)
using the store's real, encrypted-at-rest access token, and only that response is ever persisted.
This means a forged webhook (the only way one could be sent is if the per-store secret leaked)
can only cause a redundant re-fetch of real, already-existing order data — it has no path to
fabricate an order that doesn't exist in BigCommerce. Order data (via `src/lib/bigcommerce/orders-service.ts`'s
`RealOrdersService`/`MockOrdersService` pair, mirroring `catalog-service.ts`'s shape exactly) gets
full `MOCK_MODE` parity for the same reason as above — this is the feature's core functionality,
not a one-shot side effect.

Failed BigCommerce API calls during sync are allowed to surface as a 5xx response from the
receiver **on purpose** — BigCommerce's own webhook-delivery system already retries failed
deliveries with backoff, so this reuses that instead of building a custom retry/queue path. The
only other gap-filler is the manual "Sync now" action
(`src/services/order-service.ts::manualSyncRecentOrders`), which pulls a bounded set of recent
orders directly — there is no unbounded historical backfill, a deliberate scope limitation (see
`docs/api-assumptions.md`).

## Import job stage machine

Each import run moves through explicit stages (`ImportStatus` enum, `src/jobs/handlers/import-design.ts`):

```text
QUEUED → FETCHING_SOURCE → VALIDATING_SOURCE → {CREATING_PRODUCT | UPDATING_PRODUCT}
       → PROCESSING_IMAGES → WRITING_METADATA → FINALIZING → {SUCCEEDED | PARTIAL | SKIPPED}
                                                             ↘ FAILED (from any stage)
```

The handler persists `currentStage` (and, as soon as it exists, `bigcommerceProductId`) to the
`ImportRun` row **before** moving to the next external call. On retry, the handler re-derives its
starting point from that persisted state rather than assuming a fresh run:

- If `run.bigcommerceProductId` is already set, product creation is skipped entirely — the
  product-creation branch is only ever reached when it's still `null`. This is the single
  guarantee that makes "retry never creates a second product" true even across process
  crashes/restarts.
- Product **updates** are safe to repeat (PUT with the same values is idempotent at the
  BigCommerce API level), so no special-casing is needed there.
- Image processing computes `remainingSlots = maxImagesPerDesign - existingImages.length` and
  only uploads that many — a retry after a partial image failure fills in the gap rather than
  re-uploading images that already succeeded.

A design whose mapping already has a matching content fingerprint short-circuits to `SKIPPED`
**unless** this run already made progress (`hadExistingProgress`, captured before any mutation) —
otherwise a retry of a `PARTIAL` run (product created, some images failed) would incorrectly
short-circuit instead of finishing the remaining images.

**Orphaned mappings**: if the mapped BigCommerce product 404s, the mapping is marked `ORPHANED`
and the run fails with `IMPORT_ORPHANED_MAPPING` — no new product is created automatically. A
product is only ever recreated when the merchant explicitly requests it (the Designs page's
"Recreate product" action, which sets `operation: RECREATE_PRODUCT`); the handler checks that
exact operation, not just "mapping is orphaned," before treating a missing product as
recreatable.

## Idempotency and duplicate prevention

Three layers, from soft to hard:

1. **Active-run check** (`findActiveImportRunForDesign`): before enqueueing, refuse to create a
   second `ImportRun` for a design that already has one in a non-terminal state. Prevents
   double-click / double-submit from queuing duplicate work.
2. **`ImportRun.idempotencyKey`**: derived from `storeId:designId:operation:<uuid>` — unique in
   the database (preventing literal duplicate rows) but deliberately not globally stable forever,
   so a design can be re-imported after a previous run completes. The uuid suffix means this
   column is a traceability/uniqueness aid, not the actual duplicate-prevention mechanism (that's
   layer 3).
3. **`ImportMapping` unique constraint** on `(storeId, kickflipDesignId)` — the real backstop.
   Even under a race (e.g. two concurrent job attempts somehow both reach product creation), the
   database rejects the second mapping insert.

## Concurrency model

`pg-boss` v12's group-concurrency primitive maps directly onto "per-store" and "global" limits:

- Each job is sent with `group: { id: storeId }` (`src/services/import-service.ts`).
- The worker's `work()` call sets `groupConcurrency: { default: IMPORT_PER_STORE_CONCURRENCY }`
  (per-store cap, coordinated across nodes via the database) and `localConcurrency:
IMPORT_GLOBAL_CONCURRENCY` (per-node cap for that queue) — see `src/jobs/worker.ts`.
- This is a **per-queue** local cap, not a strict cross-queue global cap — with four queues each
  capped at `IMPORT_GLOBAL_CONCURRENCY`, the worst-case total concurrent jobs on one worker node
  is higher than that single number. For the single-worker-instance deployment this app targets
  (see `render.yaml`), this is an acceptable, documented simplification; a true global
  cross-queue cap would need an additional coordination layer pg-boss doesn't provide natively.
- Job expiry (`expireInSeconds: 600` per queue, `src/jobs/pgboss-queue.ts`) and pg-boss's own supervisor
  are what recover an abandoned job (worker crashed mid-job) — after the expiry window, the job
  becomes eligible for retry per the queue's `retryLimit`/`retryBackoff` policy, without any
  custom recovery code in this app.

## Prisma 7 and the driver-adapter model

Prisma 7 removed the `url`/`directUrl` fields from `datasource` in `schema.prisma` — connection
strings now live only in `prisma.config.ts` (read by the CLI for `migrate`/`generate`/`studio`,
never imported by the app itself), and the generated `PrismaClient` requires an explicit driver
adapter. This app uses `@prisma/adapter-pg` (`src/server/db/prisma.ts`), constructed from
`DATABASE_URL` at runtime — so the CLI can point at a different (e.g. unpooled) connection via
`DIRECT_DATABASE_URL` for migrations than the application uses at runtime, without any extra
plumbing.

## SQLite local dev path

Local development can run entirely without Docker or a Postgres account by setting
`DATABASE_URL=file:./local.db` (see `.env.example`). Production (Render, `render.yaml`) always
uses Postgres — `refineEnv` (`src/server/env/schema.ts`) refuses to boot with a `file:`
`DATABASE_URL` when `NODE_ENV=production`, so this can't happen by accident.

**Why this needed a real rewrite, not a config toggle**: `pg-boss` — this app's entire durable
import-job engine (see [Concurrency model](#concurrency-model) and
[Idempotency and duplicate prevention](#idempotency-and-duplicate-prevention) above) — depends on
Postgres-native mechanics (`LISTEN/NOTIFY`, `SKIP LOCKED`, advisory locks) that don't exist in
SQLite, and has no SQLite mode. `src/jobs/queue-types.ts` defines a `JobQueue` interface that
mirrors pg-boss's own `send`/`cancel`/`work` shapes exactly; `src/jobs/pgboss-queue.ts` wraps
pg-boss unchanged (production), and `src/jobs/sqlite-queue.ts` is a hand-built polling queue
against a `QueueJob` table (only in `prisma/schema.sqlite.prisma`) that satisfies the same
interface. `src/jobs/queue.ts` picks between them via `src/server/db/provider.ts`'s
`getDbProvider()`. `src/jobs/worker.ts` and `src/services/import-service.ts` — the only two
callers — don't know or care which one they got.

**What the SQLite queue does _not_ provide, unlike pg-boss**: no multi-instance/cross-process
fairness beyond SQLite's own file locking, polling (750ms tick) instead of push-based
`LISTEN/NOTIFY` (so there's up to ~750ms of added latency before a queued job starts), and no
separate dead-letter table (a permanently-failed job is just a `QueueJob` row left in the
`FAILED` state). All of this is fine for one web process + one worker process on one developer's
machine, which is the only thing this path is for — it is explicitly not a production substitute
for pg-boss, and the automated test suite (`pnpm test:integration`, `pnpm test:e2e`) continues to
run only against Postgres, unchanged.

**Two schemas, kept manually in sync**: Prisma can't target two different database kinds from one
schema file (the `provider` field must be a literal). `prisma/schema.sqlite.prisma` is a hand-kept
copy of `prisma/schema.prisma`, generating to a separate client output
(`node_modules/.prisma/client-sqlite`) with its own migration history
(`prisma/migrations-sqlite/`, applied via the `:sqlite`-suffixed `db:*` scripts in `package.json`
against `prisma.sqlite.config.ts`). Exactly two fields differ from the Postgres schema, both on
`StoreSettings`, because SQLite has no array type: `defaultCategoryIds` is `Int[]` on Postgres but
a JSON-encoded `String` on SQLite (translated back to `number[]` only inside
`src/repositories/settings-repository.ts`'s `encodeCategoryIds`/`decodeCategoryIds`, which every
other caller is unaware of via that file's own `AppStoreSettings` domain type — see
`src/jobs/options-snapshot.ts`/`src/services/settings-service.ts` for the resulting import
change), and the Postgres-only `@db.Decimal(10, 4)` native-type annotation is dropped (plain
`Decimal` behaves identically on both connectors). Everything else is copied verbatim.

**Loading the SQLite client without breaking the Postgres path or the Next.js build**: the shared
`prisma` singleton (`src/server/db/prisma.ts`) stays statically typed as the Postgres client
shape everywhere — `settings-repository.ts` and `sqlite-queue.ts` are the only two files that cast
it locally to reach the handful of fields/models (`defaultCategoryIds` as a string; the
`queueJob` model) that only exist on the SQLite side. Two real constraints shaped how the SQLite
client itself gets loaded, found by actually running it (not just reading the generated code):

1. `node_modules/.prisma/client-sqlite` isn't a valid ES module _specifier_ — Node's ESM loader
   rejects any bare specifier starting with `.` that isn't `./`/`../` as an invalid package name.
   A static `import ... from '.prisma/client-sqlite'` type-checks fine (TypeScript's `Bundler`
   moduleResolution doesn't enforce that rule) but throws at real runtime, in both `tsx` (the
   worker) and Next's bundler (the web app) — and since it's a _static_ top-level import, it would
   throw even in pure-Postgres/production mode, the moment the module loads, regardless of which
   branch actually runs. The fix: `src/server/db/prisma.ts` loads it lazily via
   `createRequire(import.meta.url)` — a `require()` obtained this way — strictly inside the
   SQLite branch, never as a top-level import. CJS `require()` resolution doesn't validate
   specifier syntax the way ESM `import` does, so the same dotted path resolves fine there (this
   is the same mechanism Prisma's own default `@prisma/client` package uses internally).
2. This project's `.npmrc` sets `shamefully-hoist=false` (deliberate strict pnpm isolation), so
   `@prisma/client-runtime-utils` — a transitive dependency the generated SQLite client needs at
   its own top level, since a custom generator `output` path isn't part of pnpm's normal
   dependency-linking graph the way `@prisma/client` itself is — never gets hoisted to root
   `node_modules` and fails to resolve. Fixed by declaring it as a direct (dev)dependency instead
   of relaxing the project's hoisting policy.

Both the SQLite adapter package (`@prisma/adapter-better-sqlite3`) and `@prisma/client-runtime-utils`
are `devDependencies`, not `dependencies` — production's `pnpm install` (Dockerfile sets
`NODE_ENV=production` before installing) skips devDependencies entirely, so the native
`better-sqlite3` addon is never installed or compiled for production. `next.config.mjs`'s
`serverExternalPackages` also lists `better-sqlite3`/`@prisma/adapter-better-sqlite3` as defense
in depth, so Next's bundler never tries to bundle the native addon on a developer machine that
does have it installed.

## Why the worker runs via `tsx`, not compiled JS

`pg-boss` is ESM-only, so this repo is `"type": "module"` throughout. Rather than fight
`NodeNext` module resolution's mandatory `.js` extension requirements for a compiled worker
bundle, the worker runs via `tsx` (esbuild-backed) in both development and production — a common,
supported pattern for TypeScript worker processes. One consequence worth knowing: any module
imported by the worker must not depend on bundler-specific behavior. This is exactly why
`import 'server-only'` was removed from every shared server module (`src/server`, `src/lib`,
`src/repositories`, `src/services`) partway through building this app — that package only
no-ops under Next.js's own bundler (via the `react-server` export condition); run through plain
`tsx`/Node, as the worker is, it unconditionally throws. Since no client component in this
codebase imports from those directories anyway (client code only ever calls the `/api/v1/*` HTTP
API), removing the guard costs no real protection.
