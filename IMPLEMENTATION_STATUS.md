# Implementation status

Living record of what was built, key decisions made along the way, and known gaps — written as
the app was built, not reconstructed after the fact. See `README.md` for user-facing docs; this
file is for whoever picks up this codebase next.

## Summary

A complete, working implementation of the spec: BigCommerce OAuth (all four callbacks), encrypted
credential storage, a Kickflip adapter behind a documented-assumptions boundary, a BigCommerce V3
Catalog adapter, an SSRF-hardened image pipeline, a durable/resumable pg-boss import engine with
real idempotency guarantees, a full authenticated API, five UI pages built with BigDesign, Docker

- Render + GitHub Actions deployment tooling, and a real test suite (156 unit tests, 23
  integration tests against real Postgres, a Playwright E2E suite) — not placeholders.

## Key architectural decisions and why

- **Prisma 7's driver-adapter model**: `schema.prisma` no longer holds a connection URL (moved to
  `prisma.config.ts`, CLI-only); the app constructs `PrismaClient` with `@prisma/adapter-pg`
  explicitly. Discovered by running `prisma validate` against a spec-typical schema and reading
  the actual error — not assumed from training-data familiarity with older Prisma versions. See
  `docs/architecture.md#prisma-7-and-the-driver-adapter-model`.
- **The whole app is ESM** (`"type": "module"`), because `pg-boss` v12 is ESM-only. The worker
  process runs via `tsx` rather than a compiled bundle, in both dev and production, to avoid
  `NodeNext` resolution's extension requirements.
- **`server-only` package removed from every shared server module** partway through building this
  app, after it was discovered (via a live Playwright run) that the worker process crashes
  immediately on startup when importing any module using it — `server-only` only no-ops under
  Next's own bundler (`react-server` export condition); run through plain `tsx`, it unconditionally
  throws. Since no client component imports these modules directly (client code only calls the
  `/api/v1/*` HTTP API), this cost no real protection. See `docs/architecture.md` for the full
  explanation. This is exactly the kind of gap a real dev-run catches and a code read-through
  doesn't — worth flagging prominently for whoever reviews this.
- **Session bootstrap via a one-time code, not an embedded token**: the BigCommerce load callback
  redirects with a single-use code (not the session token) in the URL; the browser exchanges it
  for the real bearer token via a same-origin POST. See `docs/architecture.md#embedded-session-bootstrap`.
- **Kickflip `GET /designs/{id}`** is an explicitly flagged assumption (not given in the original
  brief), with a graceful fallback to scanning the list endpoint if it 404s. See
  `docs/api-assumptions.md`.
- **Idempotency key includes a uuid suffix**, not just `storeId:designId:operation` — a purely
  static key would make a design permanently un-reimportable after its first completed run, since
  the column has a database uniqueness constraint. The real duplicate-prevention guarantee is the
  `ImportMapping` unique constraint, not this column. See `docs/architecture.md#idempotency-and-duplicate-prevention`.
- **Per-store/global concurrency via pg-boss v12's native group-concurrency**, not custom
  coordination code. Documented as a per-queue (not strict cross-queue) cap — see
  `docs/architecture.md#concurrency-model` for the precise semantics and why.
- **In-memory rate limiter**, not Redis — appropriate for the single-web-instance Render starter
  deployment this targets; documented limitation if horizontally scaled (README, deployment
  runbook).
- **`RECREATE_PRODUCT` as an explicit operation**, not an implicit consequence of retrying an
  orphaned mapping — a routine retry/re-import of an orphaned design fails with
  `IMPORT_ORPHANED_MAPPING`; only the Designs page's dedicated "Recreate product" button (which
  sends `recreate: true`) creates a replacement product. This was a deliberate reading of the
  spec's "unless the merchant explicitly chooses 'Recreate product'" requirement.

## Deviations from the suggested route/file list (and why)

- Added `POST /api/v1/session/bootstrap` (not in the spec's suggested route list) — required by
  the one-time-code session bootstrap design above; the spec's security requirements (no token in
  URL, replay protection) can't be satisfied without an exchange endpoint.
- Added `GET /health/live` and `/health/ready` under `src/app/health/*` (spec's route list already
  includes these paths; implemented as specified).
- `src/repositories/` includes the six named files plus `settings-repository.ts` (StoreSettings
  wasn't in the spec's example repository list but is a first-class model with its own CRUD needs).
- `src/server/session/bootstrap.ts` and `store.ts` hold the `OneTimeToken`/`AppSession`
  persistence logic rather than a `session-repository.ts` — kept close to the session module
  since these tables exist purely to support that one subsystem, not as general-purpose
  repositories other services query independently.

## SQLite local-dev path (added after initial build)

Local development can now run without Docker or a Postgres account: set
`DATABASE_URL=file:./local.db` and the app switches to SQLite + a hand-built job queue
(`src/jobs/sqlite-queue.ts`) that replaces `pg-boss` (Postgres-only, no SQLite equivalent) for
that path only. Production (Render) is completely unaffected — always Postgres + pg-boss, guarded
by a production-only `refineEnv` check that rejects a `file:` `DATABASE_URL`. See
`docs/architecture.md#sqlite-local-dev-path` for the full design (the `JobQueue` abstraction, the
two hand-synced Prisma schemas, and two real pnpm/Node-ESM loading gotchas found by actually
running it, not just reading the generated code).

**Known limitation**: this path is not covered by `pnpm test:integration` or `pnpm test:e2e`,
which continue to run only against Postgres, unchanged — deliberately, to avoid duplicating the
whole test matrix for a local-convenience-only backend. `src/jobs/sqlite-queue.test.ts` and
`src/repositories/settings-repository.test.ts` unit-test the pure logic (group-aware job claiming,
retry/backoff decisions, the `defaultCategoryIds` JSON encode/decode boundary) but not the full
polling loop against a real database. A next iteration that leans on this path heavily would
benefit from at least one real end-to-end smoke test (enqueue → claim → complete, and the
crash-recovery/lease-expiry path) against an ephemeral SQLite file, even if it stays outside the
Postgres integration-test tier.

## Known gaps / what a next iteration should do first

1. **Re-verify the E2E suite live, post-`server-only`-fix.** The bug (worker crash) was found via
   an actual Playwright run and the fix (`git grep -rl "server-only"`, remove from ~40 files) was
   verified via typecheck + lint + the full unit suite passing afterward, but a live end-to-end
   Playwright re-run was blocked by the environment issue described below. **Do this before
   trusting the E2E suite is green.**
2. **`MASTER_ENCRYPTION_KEY` rotation is a documented manual procedure, not automated** (see
   `docs/token-rotation.md`) — deliberately, since an unattended re-encryption-of-everything
   migration deserves a human running it, but a real operator will want a tested script, not just
   a procedure description.
3. **No React Testing Library component tests were written** — time was spent on unit tests for
   business logic (crypto, mapping, authorization, retry/backoff, SSRF, etc.) and integration
   tests for the full request pipeline instead, which cover more real risk per hour spent than
   shallow component snapshot tests would have. If component-level tests are added later, they'll
   need their own Vitest project with `environment: 'jsdom'` (the current `unit` project uses
   `'node'` — see `vitest.config.ts`).
4. **Full cross-queue global concurrency isn't enforced**, only per-queue — see
   `docs/architecture.md#concurrency-model`.
5. **Data-deletion-on-request is a documented SQL procedure, not a self-service endpoint** — see
   `SECURITY.md#data-retained-after-uninstall`.
6. **The Kickflip `/designs/{id}` endpoint assumption should be verified against real API docs**
   the moment they're available — see `docs/api-assumptions.md`.

## Environment note encountered during this build (not a code defect)

Late in this session, the development machine's C: drive filled to 0 bytes free, and Docker
Desktop became unresponsive shortly after (its WSL2 backend likely couldn't write). This was
**not caused primarily by this project** — investigation showed the user-profile folders relevant
to this work (`node_modules`, the pnpm store, Docker's own WSL2 disk, Playwright's browser cache)
account for well under the drive's total capacity; the bulk of the ~238GB in use is elsewhere on
the machine, outside this project's or even this user account's typical footprint, and outside
what could responsibly be investigated or cleaned without broader access/authorization. Disposable
build artifacts (`.next`, Playwright's `test-results`/`playwright-report`, the pnpm store cache)
were cleared to regain enough headroom (~250-560MB, fluctuating) to keep working. **Recommend the
user check overall disk usage on this machine independent of this project.** Practical
consequence for this repo: the final live re-run of `pnpm test:integration` and `pnpm test:e2e`
after the `server-only` fix could not be completed in-session once Docker stopped responding —
see gap #1 above.
