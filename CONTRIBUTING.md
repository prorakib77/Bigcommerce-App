# Contributing

## Getting started

See the README's [Local setup](README.md#local-setup) section. In short:

```bash
pnpm install
docker compose up -d postgres
cp .env.example .env   # fill in generated keys; MOCK_MODE=true works without real credentials
pnpm db:migrate
pnpm dev
pnpm worker:dev
```

## Before opening a PR

Run the full verification pipeline locally:

```bash
pnpm verify   # format:check + lint + typecheck + test + build
```

For changes touching the database schema, jobs, OAuth callbacks, or import logic, also run:

```bash
docker compose --profile test up -d postgres-test
TEST_DATABASE_URL=postgresql://kickflip_app_test:changeme@localhost:5545/kickflip_app_test?schema=public \
  pnpm exec prisma migrate deploy
TEST_DATABASE_URL=postgresql://kickflip_app_test:changeme@localhost:5545/kickflip_app_test?schema=public \
  pnpm test:integration
```

CI runs all of this automatically (`.github/workflows/ci.yml`) and requires no real BigCommerce
or Kickflip credentials.

## Code conventions

- Strict TypeScript; no unexplained `any`, no disabled type checking, no ignored lint errors.
- No business logic inside React components — components call into `services/` through the
  `/api/v1/*` routes; they never import Prisma or the Kickflip/BigCommerce clients directly.
- No direct external API calls from browser code — everything server-side goes through
  `src/lib/kickflip` or `src/lib/bigcommerce`, both of which validate every response with Zod.
  Add new capability there, not ad hoc `fetch()` calls elsewhere.
- Centralize, don't duplicate: authorization checks go through `src/server/authorization`,
  retry/backoff logic goes through `src/server/http/fetch-with-retry.ts` and `backoff.ts`,
  errors go through `AppError` (`src/server/errors`) with a stable public `code`.
- Money and weight are decimal strings/Prisma `Decimal`, never floating-point arithmetic.
- Prefer editing an existing module over adding a new abstraction. No speculative
  generalization for hypothetical future requirements.
- Comments explain _why_, not _what_ — only where the reasoning genuinely isn't obvious from the
  code (a workaround, a non-obvious invariant, a constraint from an external system).

## Updating the Kickflip adapter

If the real Kickflip API differs from what's assumed in `src/lib/kickflip/schemas.ts` and
`mapper.ts`, see [`docs/api-assumptions.md`](docs/api-assumptions.md) for exactly what to change
— by design, only files under `src/lib/kickflip/` should need updating; the rest of the app
depends on the normalized `NormalizedKickflipDesign` shape, not the raw API response.

## Database changes

Always go through Prisma Migrate — never hand-edit `prisma/schema.prisma` without generating a
matching migration:

```bash
pnpm db:migrate    # prompts for a migration name, applies it locally
```

Commit the generated `prisma/migrations/<timestamp>_<name>/migration.sql` alongside the schema
change. CI validates that migrations apply cleanly to an empty database and that `prisma migrate
status` reports no drift.

## Commit / PR expectations

- Keep commits focused; explain _why_ in the commit message, not just _what_.
- Update the relevant doc (README, SECURITY.md, or a `docs/*.md`) in the same PR as a behavioral
  change — docs that drift from the code are worse than no docs.
- Don't commit `.env`, real credentials, or anything under a `sync: false` Render env var.
