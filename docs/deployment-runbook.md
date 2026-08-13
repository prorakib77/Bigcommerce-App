# Deployment runbook (Render)

## Prerequisites

- A Render account with billing configured (the `starter` plans used in `render.yaml` are paid).
- A BigCommerce draft app already created (see the README's
  [BigCommerce draft-app setup](../README.md#bigcommerce-draft-app-setup)) — you'll need its
  callback URLs to match your Render domain before installing on a real store.
- This repository pushed to a Git provider Render can access.

## First deploy

1. In the Render dashboard, **New → Blueprint**, point it at this repository. Render reads
   `render.yaml` and proposes: a PostgreSQL database (`kickflip-import-db`), a web service
   (`kickflip-import-web`), and a worker background service (`kickflip-import-worker`).
2. Apply the blueprint. The database provisions first; the two services will fail their first
   deploy because required `sync: false` env vars aren't set yet — that's expected.
3. Generate the two required keys locally and note them down:

   ```bash
   openssl rand -base64 32   # MASTER_ENCRYPTION_KEY
   openssl rand -base64 48   # APP_SESSION_SIGNING_KEY
   ```

4. In the Render dashboard, for **both** `kickflip-import-web` and `kickflip-import-worker`, set
   the same values for every `sync: false` variable listed in `render.yaml`:
   - `APP_BASE_URL` — `https://<your-web-service>.onrender.com` (or your custom domain)
   - `BIGCOMMERCE_CLIENT_ID`, `BIGCOMMERCE_CLIENT_SECRET` — from the BigCommerce draft app
   - `BIGCOMMERCE_AUTH_CALLBACK_URL` — `${APP_BASE_URL}/api/bigcommerce/auth`
   - `BIGCOMMERCE_LOAD_CALLBACK_URL` — `${APP_BASE_URL}/api/bigcommerce/load`
   - `BIGCOMMERCE_UNINSTALL_CALLBACK_URL` — `${APP_BASE_URL}/api/bigcommerce/uninstall`
   - `BIGCOMMERCE_REMOVE_USER_CALLBACK_URL` — `${APP_BASE_URL}/api/bigcommerce/remove-user`
   - `MASTER_ENCRYPTION_KEY`, `APP_SESSION_SIGNING_KEY` — generated above
   - `KICKFLIP_ALLOWED_IMAGE_HOSTS` — the real Kickflip/CDN hostnames you'll import images from
   - `SENTRY_DSN`, `OTEL_EXPORTER_OTLP_ENDPOINT` — optional, leave blank to disable
5. Trigger a manual deploy on both services (or push a commit). The web service's
   `preDeployCommand` (`pnpm prisma migrate deploy`) applies any pending migrations before the
   new instance goes live.
6. In the BigCommerce Developer Portal, set the draft app's four callback URLs to match step 4
   exactly, and confirm the requested scopes match `BIGCOMMERCE_APP_SCOPES`: Products: Modify,
   Content, Orders: Read-Only, and Carts: Modify.
7. Install the app on a sandbox store and confirm: install completes, the dashboard loads, a
   mock-free Kickflip connection can be tested and saved, and a real import completes end to end.

## Ongoing deploys

`autoDeployTrigger: commit` in `render.yaml` means pushes to the connected branch deploy
automatically. The web service's `preDeployCommand` re-runs migrations before every deploy —
never deploy a schema-changing PR without a corresponding migration committed
(`pnpm db:migrate` locally, commit the generated SQL).

## Health checks

- Web service `healthCheckPath: /health/live` — process-liveness only, no I/O. Render restarts
  the instance if this stops responding.
- `/health/ready` additionally checks database connectivity and configuration validity; it is not
  wired as the Render health check path deliberately (readiness dips during a deploy are normal
  and shouldn't trigger a restart loop) but is useful for manual/external monitoring.
- The worker service has no HTTP endpoint (Render "worker" services don't get one) — monitor it
  via Render's log stream and the Imports page's job throughput.

## Scaling

`render.yaml` provisions one instance of each service (`numInstances: 1`). Before scaling the web
service horizontally, read the rate-limiting note in the README — the in-memory limiter
(`src/server/rate-limit`) is per-instance; multiple web instances would each enforce their own
budget rather than a shared one. Scaling the worker to multiple instances is safe as-is: pg-boss's
group-concurrency coordination is database-backed, not in-memory, so per-store fairness holds
across worker instances.

## Graceful shutdown

Both processes handle `SIGTERM`: the web process is Next's own production server (handles
`SIGTERM` natively); the worker (`src/jobs/worker.ts`) calls `pgBoss.stop({ graceful: true,
timeout: 30_000 })` on `SIGTERM`/`SIGINT`, letting in-flight jobs finish (or hit their own
`expireInSeconds`) before the process exits. Render sends `SIGTERM` and waits before force-killing
on every deploy/restart, so this is exercised on every deploy.

## Logs

Render's built-in log stream captures both services' structured JSON (Pino) output. For longer
retention or search, pipe Render's log stream to an external sink (Render supports log stream
forwarding to common providers) — this app has no built-in log-shipping integration and doesn't
need one; standard JSON-line logs to stdout are sufficient for any standard forwarder.

## Rolling back

Render keeps prior deploys; use **Rollback** on the web service in the dashboard for a bad
release. Because migrations are additive-only in this schema so far (no destructive migration has
been written), rolling back the application code while the database stays on the newer schema is
safe. If a future migration is destructive (a dropped/renamed column), roll back the database
first via a new forward migration, not by reverting the migration file after it's been applied
in production.
