# Token rotation

## Kickflip API token (per store)

Merchant-driven, no downtime:

1. Merchant opens **Settings** and enters a new token (tenant ID may stay the same or change).
2. The app tests the new credential against Kickflip **before** saving anything
   (`testKickflipCredentials`, `src/services/connection-service.ts`).
3. On success: the new token is encrypted, saved transactionally, and an audit event
   (`kickflip_connection.saved`) is recorded. The old encrypted value is overwritten in the same
   write — there is no window where both old and new tokens are simultaneously valid in storage.
4. On failure: nothing is saved; the connection's `lastErrorCode` is recorded and the merchant
   sees the test failure immediately.

No app restart or deploy is required. This is the expected, routine rotation path — encourage
merchants to rotate periodically per their own Kickflip account's security policy.

## BigCommerce access token (per store)

BigCommerce access tokens aren't rotated by this app directly — a merchant reinstalling the app
(or BigCommerce itself re-issuing a token) triggers `upsertStoreInstall`
(`src/repositories/store-repository.ts`) via the auth callback, which overwrites the encrypted
token. There's no merchant-facing "rotate BigCommerce token" action because BigCommerce doesn't
expose one to third-party apps — reinstall is the mechanism.

## `MASTER_ENCRYPTION_KEY`

This is the highest-impact rotation: every encrypted Kickflip and BigCommerce token in the
database was encrypted with the _current_ key, and the app has no automatic re-encryption
pipeline yet. Rotating it without a migration pass makes every stored credential undecryptable.

**Documented procedure** (manual, run during a maintenance window):

1. Generate a new key: `openssl rand -base64 32`.
2. Deploy a one-off script (not currently included in this repo — write one following this
   procedure if you need to rotate) that, for every row with a non-null encrypted token:
   - Decrypts with the **old** key (temporarily available as a second env var, e.g.
     `MASTER_ENCRYPTION_KEY_OLD`).
   - Re-encrypts with the **new** key.
   - Writes the new envelope in the same transaction as the read, per row.
3. Only after every row is confirmed re-encrypted, update `MASTER_ENCRYPTION_KEY` to the new
   value everywhere (web + worker) and remove the old-key env var.
4. Verify by testing a Kickflip connection and confirming a BigCommerce API call succeeds for a
   sample of stores post-rotation.

This is intentionally not automated in v1 — an unattended re-encryption migration touching every
credential in the database is exactly the kind of operation that deserves a human running it
during a maintenance window with a tested rollback plan, not a button in the admin UI.

## `APP_SESSION_SIGNING_KEY`

Lower-impact: rotating this key invalidates every currently-issued session JWT immediately
(they fail signature verification against the new key), but **does not** touch any stored data —
sessions are ephemeral by design. Simply update the env var and redeploy; merchants using the app
at that moment will see their next API call fail with `SESSION_EXPIRED` and be prompted to reload
from BigCommerce, which issues a fresh session. Safe to do at any time, no maintenance window
required.

## `BIGCOMMERCE_CLIENT_SECRET`

Rotating this in the BigCommerce Developer Portal immediately invalidates the app's ability to
verify `signed_payload_jwt` callbacks signed with the old secret, and to exchange new
authorization codes. Update `BIGCOMMERCE_CLIENT_SECRET` in both services' env vars and redeploy
**before** (or as close to simultaneously as possible to) rotating it in the Developer Portal, to
minimize the window where callbacks fail verification.
