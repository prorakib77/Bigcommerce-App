# Incident runbook

Operational playbooks for the most likely production incidents. Pair with
[`docs/deployment-runbook.md`](deployment-runbook.md) (how the app is deployed) and
[`SECURITY.md`](../SECURITY.md) (secret handling, encryption design).

## Suspected credential leak (Kickflip token, BigCommerce token, or app secrets)

1. **Contain**: rotate the affected secret immediately — see
   [`docs/token-rotation.md`](token-rotation.md) for the exact procedure per secret type. For a
   `MASTER_ENCRYPTION_KEY` or `APP_SESSION_SIGNING_KEY` leak, treat it as the highest priority:
   every encrypted token and every active session is compromised until rotated.
2. **Revoke sessions**: rotating `APP_SESSION_SIGNING_KEY` invalidates all existing sessions
   immediately (they fail signature verification against the new key) — merchants will simply be
   asked to reload the app from BigCommerce.
3. **Assess scope**: check `audit_logs` for the affected store(s) around the suspected exposure
   window (`action` values like `kickflip_connection.saved`, `store.installed`) to understand
   what the leaked credential could have accessed.
4. **Notify**: if a merchant's Kickflip or BigCommerce credential was genuinely exposed (not just
   this app's own secrets), notify the affected merchant(s) per your organization's disclosure
   policy.
5. **Post-incident**: confirm the leak vector (log line, error message, misconfigured env var
   dump, etc.) and add a regression test/lint rule that would have caught it — see the redaction
   patterns in `src/server/logging/redaction.ts` as the place such a fix usually belongs.

## Worker down / imports stuck in QUEUED

1. Check the Render dashboard for `kickflip-import-worker` — is it running, crash-looping, or
   deployed at all?
2. Check its logs for a startup failure — most commonly an environment validation error (missing
   var) or a database connectivity issue (same `DATABASE_URL` as the web service).
3. Once the worker is healthy again, queued jobs resume automatically — `pg-boss` requires no
   manual re-triggering. Jobs that were `active` when the worker died recover once their
   `expireInSeconds` (600s) elapses and the queue's retry policy kicks in.
4. If a specific import is stuck beyond that, use the Imports page's **Retry** action — it
   re-enqueues the same `ImportRun` row, so this is safe to do even if you're not sure whether the
   original job is still "in flight."

## Database connectivity issues

1. Check the managed Postgres instance's status in the Render dashboard.
2. Both services validate `DATABASE_URL` at startup and will crash-loop (visibly, in logs) rather
   than run in a half-broken state — this is intentional (`src/server/env`).
3. `/health/ready` on the web service reports `503` when the database is unreachable; use it to
   confirm recovery before assuming the incident is over.

## BigCommerce API returning sustained errors (429s or 5xxs)

1. Both `src/lib/bigcommerce/client.ts` and `src/lib/kickflip/client.ts` already retry
   transient failures with bounded exponential backoff — sustained errors beyond the retry budget
   surface as `FAILED` import runs with a safe error code (`BIGCOMMERCE_RATE_LIMITED`,
   `BIGCOMMERCE_API_UNAVAILABLE`, etc.), not silent data loss.
2. Check BigCommerce's status page for a platform-wide incident before assuming a bug in this app.
3. Once BigCommerce recovers, use the Imports page's bulk view (filter by `FAILED`) and retry
   affected runs — retries resume from the correct stage per the idempotency guarantees in
   [`docs/architecture.md`](architecture.md#import-job-stage-machine).

## Suspected SSRF / image-ingestion abuse

1. Check `KICKFLIP_ALLOWED_IMAGE_HOSTS` — if an unexpected host is present, remove it and
   redeploy immediately.
2. Review worker logs for `IMAGE_HOST_NOT_ALLOWED` / `IMAGE_DOWNLOAD_FAILED` entries around the
   suspected window — every rejected or failed image attempt is logged (URL redacted) with a
   correlation ID.
3. The SSRF protections (allowlist, DNS/IP-range blocking, redirect re-validation) are
   defense-in-depth by design — see [`SECURITY.md`](../SECURITY.md#image-ingestion--ssrf-protection).
   If one layer is found to have a gap, the fix belongs in `src/lib/images/`, and should ship with
   a regression test in `src/lib/images/*.test.ts` (see the existing `ssrf.test.ts` for the
   pattern: exhaustive blocked/allowed IP tables).

## Uninstall didn't stop something it should have

1. Confirm the store's `stores.is_active` flag flipped to `false` and `uninstalled_at` is set —
   the uninstall callback (`src/app/api/bigcommerce/uninstall/route.ts`) does this
   transactionally with cancelling queued jobs.
2. A job that was already **running** (not queued) when uninstall happened checks
   `store.isActive` at the top of its handler and before every external API write
   (`src/jobs/handlers/*`) — it should fail fast with `STORE_INACTIVE` rather than continue. If
   you find a code path that writes to BigCommerce for an inactive store, that's a bug — file it
   with the correlation ID from the job's `ImportRun` row.

## Escalation

For anything not covered above: check `audit_logs` and the relevant `ImportRun`/`AppSession` rows
for the affected store first — the app is built to make its own state legible (structured logs,
correlation IDs threaded through every request/job, an audit trail for sensitive actions) rather
than requiring guesswork.
