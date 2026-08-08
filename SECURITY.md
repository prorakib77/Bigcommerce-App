# Security

This document explains how this app handles secrets, encryption, sessions, image ingestion, and
incident response, and how to report a vulnerability.

## Reporting a vulnerability

Please report suspected vulnerabilities privately rather than opening a public issue. Include a
description of the issue, reproduction steps, and its potential impact. Do not include real
BigCommerce/Kickflip credentials or customer data in a report. We aim to acknowledge reports
within a reasonable timeframe and will coordinate disclosure with the reporter.

## Secret handling

| Secret                                                                          | Where it lives                                                             | Never appears in                                                  |
| ------------------------------------------------------------------------------- | -------------------------------------------------------------------------- | ----------------------------------------------------------------- |
| BigCommerce access token (per store)                                            | Encrypted in `stores.encrypted_access_token`                               | Logs, error messages, API responses, job payloads, client bundles |
| Kickflip API token (per store)                                                  | Encrypted in `kickflip_connections.encrypted_api_token`                    | Same as above                                                     |
| `MASTER_ENCRYPTION_KEY`, `APP_SESSION_SIGNING_KEY`, `BIGCOMMERCE_CLIENT_SECRET` | Process environment only (Render env vars / local `.env`, never committed) | Logs, client bundles, error messages                              |
| Internal app session token                                                      | Signed JWT, held in browser memory only for its ~15 minute lifetime        | `localStorage`, `sessionStorage`, cookies, logs                   |

Durable job payloads (`src/jobs/queues.ts`) carry only a database row ID — never a decrypted
credential. The worker decrypts credentials in memory, only for the duration of a single job
attempt, immediately before use (`src/services/connection-service.ts`,
`decryptSecret(store.encryptedAccessToken)` in `src/jobs/handlers/*`).

## Encryption design

Tokens at rest use **AES-256-GCM** (authenticated encryption) via `src/server/crypto/encryption.ts`:

- A fresh random 96-bit nonce is generated for every encryption call — nonces are never reused
  with the same key.
- The stored envelope is versioned: `v1.<iv>.<authTag>.<ciphertext>` (all base64). The version
  prefix lets a future key-derivation or algorithm change roll forward without breaking
  decryption of previously-stored values.
- GCM's authentication tag means any tampering with the ciphertext causes decryption to fail
  loudly (`DecryptionError`) rather than silently returning corrupted plaintext.
- The encryption key (`MASTER_ENCRYPTION_KEY`) is a separate, server-only 32-byte key, distinct
  from the session-signing key, distinct from the BigCommerce client secret. It is validated at
  startup (`src/server/env`) to be exactly 32 bytes when base64-decoded — the app refuses to
  boot otherwise.

## Internal session design

See the README's architecture section and `src/server/session/`. Summary: after a verified
BigCommerce load callback, the app issues a short-lived (default 15 minute), signed HS256 JWT
carrying only a session ID, store ID, BigCommerce user ID, role, and a unique token ID. The
token ID's hash is stored server-side (`app_sessions` table), which is what makes the session
**revocable** — uninstall, remove-user, and credential rotation all revoke matching sessions
immediately, independent of the JWT's own expiry. The one-time bootstrap code that hands the
token to the browser (`src/server/session/bootstrap.ts`) is single-use, enforced via an atomic
conditional database update, and expires in 60 seconds — replaying a captured bootstrap URL does
nothing.

## Token rotation

See [`docs/token-rotation.md`](docs/token-rotation.md) for the full procedure for each secret
type (Kickflip token, BigCommerce token, master encryption key, session signing key).

## Incident response

See [`docs/incident-runbook.md`](docs/incident-runbook.md).

## Data retained after uninstall

Uninstalling a store immediately:

- Marks the store inactive and revokes all its sessions
- Clears the encrypted Kickflip API token is left as-is on the `KickflipConnection` row (already
  encrypted, no longer usable since no new Kickflip requests are made for an inactive store) —
  operators may run the documented deletion process below for a full purge
- Cancels queued (not-yet-started) import jobs
- **Never** deletes BigCommerce products

Import mappings and audit history are preserved for `DATA_RETENTION_DAYS` (default 365) to
support a clean reinstall. For a full data-deletion request (e.g. GDPR/CCPA), an operator can
run:

```sql
-- Replace :store_hash. Run only after confirming the store should be fully purged.
DELETE FROM audit_logs WHERE store_id = (SELECT id FROM stores WHERE store_hash = :store_hash);
DELETE FROM import_runs WHERE store_id = (SELECT id FROM stores WHERE store_hash = :store_hash);
DELETE FROM import_mappings WHERE store_id = (SELECT id FROM stores WHERE store_hash = :store_hash);
DELETE FROM app_sessions WHERE store_id = (SELECT id FROM stores WHERE store_hash = :store_hash);
DELETE FROM kickflip_connections WHERE store_id = (SELECT id FROM stores WHERE store_hash = :store_hash);
DELETE FROM store_users WHERE store_id = (SELECT id FROM stores WHERE store_hash = :store_hash);
DELETE FROM store_settings WHERE store_id = (SELECT id FROM stores WHERE store_hash = :store_hash);
DELETE FROM stores WHERE store_hash = :store_hash;
```

This intentionally has no one-click UI button — full data deletion is destructive and
irreversible, and should go through a human operator following this documented, auditable
procedure. A future release could automate this behind an owner-confirmed, rate-limited endpoint.

## Logging redaction

`src/server/logging/redaction.ts` defines a pattern matched against every log field name
(`authorization`, `*token*`, `*secret*`, `password`, `signed_payload_jwt`, etc.) and wires it
into Pino's built-in `redact` option (`src/server/logging/logger.ts`), so matching fields are
replaced with `[REDACTED]` even if a field with a sensitive name is accidentally logged.
Additionally:

- Image URLs are logged only after `redactUrl()` strips query strings and embedded credentials
  — Kickflip image URLs are frequently signed with time-limited tokens in the query string.
- OAuth authorization codes, full callback JWTs, and BigCommerce/Kickflip access tokens are
  never passed to the logger at all (not just redacted) — see `src/lib/bigcommerce/oauth.ts` and
  `src/lib/bigcommerce/callbacks.ts`.
- `AppError` (`src/server/errors/app-error.ts`) separates the safe, public-facing message from
  any sensitive `context` — only the safe message and a correlation ID ever reach the client;
  full context is server-log-only.

## Image ingestion / SSRF protection

Kickflip design images are fetched from URLs the app does not control. `src/lib/images/`
implements defense in depth:

1. **Allowlist** (`allowlist.ts`): exact hostname match against `KICKFLIP_ALLOWED_IMAGE_HOSTS` —
   no implicit subdomain trust. HTTPS required.
2. **DNS/IP-range blocking** (`ssrf.ts`): loopback, private (RFC 1918), link-local (including the
   `169.254.169.254` cloud metadata endpoint), carrier-grade NAT, multicast, and the IPv6
   equivalents (including IPv4-mapped IPv6 addresses) are all blocked.
3. **DNS-rebinding protection** (`download.ts`): the IP-range check runs inside the actual
   connection's DNS resolver (a custom `undici` `Agent` `connect.lookup`), not as a separate
   earlier check — so a hostname that resolves safely at check time and differently at connect
   time can't slip through.
4. **Redirect re-validation**: redirects are followed manually (`redirect: 'manual'`), one hop at
   a time, up to `IMAGE_MAX_REDIRECTS`, with the full allowlist+SSRF check re-applied to every
   hop's target URL.
5. **Bounded, streamed download**: a hard byte cap (`IMAGE_MAX_BYTES`) is enforced while
   streaming, not after buffering the whole response.
6. **Content-type verification**: both the declared `Content-Type` header and the actual file's
   magic bytes are checked; the sniffed type wins. SVG is deliberately unsupported (can embed
   scripts). Filename extensions are never trusted.
7. **No local persistence**: downloaded bytes live in memory only for the duration of the
   BigCommerce upload call; nothing is written to disk.

There is no general-purpose URL-fetching endpoint anywhere in the app — image URLs are only ever
sourced from an authenticated Kickflip API response, never from user-supplied input.

## Storefront Customize iframe — trust boundary

The per-product Customize URL (`src/app/api/v1/bigcommerce/products/[productId]/customize`) is a
**merchant-controlled** value, validated only for `https://` and a 2048-character length cap —
this app does not vet, allowlist, or restrict its destination the way it does Kickflip image URLs
above. The storefront widget script renders it in an `<iframe>` with **no `sandbox` attribute**:
a merchant who configures a Customize URL is granting that origin the same effective trust an
merchant-added Script Manager embed would have. Only `OWNER`/`USER` roles with
`MANAGE_IMPORTS`-tier access can set this value (see [OAuth scopes](README.md#oauth-scopes) and
`src/server/authorization/index.ts`); this app has no defense against a store user with that
access deliberately configuring a malicious iframe target — that risk is inherent to giving
in-app users control over a live storefront embed, and is not mitigated further in this release.

## Orders webhook receiver — a different trust model than the rest of this app

`POST /api/public/webhooks/bigcommerce/orders` is the one endpoint in this app that authenticates
callers by neither the internal bearer-session model (`src/server/session/`) nor an OAuth token —
it's called directly by BigCommerce's servers, which can't hold either. Its security model:

- **Shared-secret header, not a signature.** BigCommerce webhooks are assumed to carry no
  cryptographic signature (see `docs/api-assumptions.md` for the full caveat and the "prefer HMAC
  if later confirmed" note). Authenticity is a random 32-byte-hex secret, generated per store at
  webhook-registration time, supplied to BigCommerce as a custom header value it's expected to
  echo back on every delivery, and compared on receipt.
- **Constant-time comparison.** The header is compared against the stored secret with
  `crypto.timingSafeEqual` (`src/server/crypto/hash.ts::timingSafeEqualStrings`), not `===` — a
  plain string comparison on a security-bearing secret would leak timing information about how
  many leading bytes matched. A missing secret (store never finished registration) or a
  length-mismatched header both fail closed, before `timingSafeEqual` is ever called (which
  throws, rather than returning `false`, on unequal-length buffers).
- **Re-fetch, never trust the payload.** The delivered webhook body is treated as a trigger only
  (`{ data: { type, id } }`) — every field actually persisted is re-fetched from BigCommerce's own
  Orders API using the store's real access token first. A forged request (the only way one could
  arrive is a leaked per-store secret) can therefore only cause a redundant re-fetch of real,
  already-existing order data; it has no path to fabricate a fake order.
- **Rate-limited by storeHash, not caller IP** (`RATE_LIMIT_WEBHOOK_*` env vars) — deliberately
  different from every other rate-limited endpoint in this app, because the caller here is
  BigCommerce's own shared server infrastructure, not an end-user browser; IP-keying would
  incorrectly pool every tenant's webhook traffic into one bucket. **Known, accepted gap**: a
  per-storeHash limiter doesn't bound an attacker spraying many different storeHash values in
  parallel (storeHash is not itself treated as a secret anywhere in this app — see how it's used
  in URLs throughout).
- **No differentiation of "store doesn't exist" from other benign cases** — an unknown or inactive
  store gets the same 200 no-op response as a fully valid, uneventful delivery, matching the
  existing convention in the `remove-user`/`uninstall` OAuth callbacks.

## Other controls

- Strict environment validation at startup (`src/server/env`), refusing to boot in production
  with missing/placeholder/weak secrets or `MOCK_MODE` enabled.
- CSP with a per-request nonce and a precise `frame-ancestors` (BigCommerce domains only) instead
  of `X-Frame-Options` (`src/middleware.ts`).
- No wildcard CORS anywhere, with **one narrow, deliberate exception**:
  `GET /api/public/storefront/customize-config` sets `Access-Control-Allow-Origin: *`
  (`src/server/http/cors.ts`, applied only at that one route's export boundary — not wired into
  `publicRoute`/`authedRoute` generally). It's safe as a public exception because the response is
  read-only, non-personalized, carries no credentials, and — by design — never reveals whether a
  given product id exists (`{enabled:false}` covers both "not configured" and "store/product
  unknown"). It exists because the storefront Customize-button widget script
  (`src/lib/bigcommerce/storefront-widget.ts`) fetches it cross-origin from the merchant's
  storefront domain. Every other route in this app remains same-origin only.
- Request body size limits (`src/server/http/body.ts`) independent of `Content-Length`.
- Per-store/IP rate limiting on sensitive endpoints (credential test/save, session bootstrap).
- Centralized, mandatory server-side authorization checks (`src/server/authorization`) — the
  client-sent store ID is never trusted; every route resolves store/user from the verified
  session.
- HTML sanitization (`sanitize-html`, allowlist-based) for generated product descriptions; no
  `dangerouslySetInnerHTML` anywhere in the codebase.
- Database-level uniqueness constraints back every duplicate-prevention guarantee — application
  logic is a fast path, not the sole enforcement.
- `pnpm audit` runs in CI (informational; see `.github/workflows/ci.yml`); Dependabot is
  configured for npm, Docker base image, and GitHub Actions updates; CodeQL static analysis runs
  on every push/PR to `main`.
