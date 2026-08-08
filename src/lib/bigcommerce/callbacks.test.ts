import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { SignJWT } from 'jose';
import { verifyBigCommerceCallbackJwt, requireStoreHash } from './callbacks';

const CLIENT_ID = 'test_client_id';
const CLIENT_SECRET = 'test_client_secret';
const SECRET_BYTES = new TextEncoder().encode(CLIENT_SECRET);

async function signPayload(
  overrides: Record<string, unknown> = {},
  opts: { expired?: boolean } = {},
) {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    sub: 'stores/abc123',
    context: 'stores/abc123',
    user: { id: 1000, email: 'owner@example.com' },
    owner: { id: 1000, email: 'owner@example.com' },
    ...overrides,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer('bc')
    .setAudience(CLIENT_ID)
    .setIssuedAt(now)
    .setExpirationTime(opts.expired ? now - 60 : now + 300)
    .setJti(randomUUID())
    .sign(SECRET_BYTES);
}

describe('verifyBigCommerceCallbackJwt', () => {
  it('accepts a validly signed payload from the configured client', async () => {
    const token = await signPayload();
    const payload = await verifyBigCommerceCallbackJwt(token);
    expect(payload.sub).toBe('stores/abc123');
    expect(payload.user.id).toBe(1000);
    expect(payload.owner.id).toBe(1000);
  });

  it('rejects a token signed with the wrong secret', async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({
      sub: 'stores/abc123',
      user: { id: 1, email: 'a@example.com' },
      owner: { id: 1, email: 'a@example.com' },
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('bc')
      .setAudience(CLIENT_ID)
      .setIssuedAt(now)
      .setExpirationTime(now + 300)
      .sign(new TextEncoder().encode('wrong-secret'));

    await expect(verifyBigCommerceCallbackJwt(token)).rejects.toThrow();
  });

  it('rejects a token with the wrong issuer (must always be the literal "bc")', async () => {
    const token = await signPayload();
    // Re-sign with a different issuer but same secret to isolate the issuer check.
    const now = Math.floor(Date.now() / 1000);
    const wrongIssuer = await new SignJWT({
      sub: 'stores/abc123',
      user: { id: 1, email: 'a@example.com' },
      owner: { id: 1, email: 'a@example.com' },
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('someone_else')
      .setAudience(CLIENT_ID)
      .setIssuedAt(now)
      .setExpirationTime(now + 300)
      .sign(SECRET_BYTES);

    await expect(verifyBigCommerceCallbackJwt(wrongIssuer)).rejects.toThrow();
    // sanity: the correctly-issued token above still verifies fine.
    await expect(verifyBigCommerceCallbackJwt(token)).resolves.toBeDefined();
  });

  it("rejects a token with the wrong audience (must match this app's client ID)", async () => {
    const now = Math.floor(Date.now() / 1000);
    const wrongAudience = await new SignJWT({
      sub: 'stores/abc123',
      user: { id: 1, email: 'a@example.com' },
      owner: { id: 1, email: 'a@example.com' },
    })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('bc')
      .setAudience('some_other_app_client_id')
      .setIssuedAt(now)
      .setExpirationTime(now + 300)
      .sign(SECRET_BYTES);

    await expect(verifyBigCommerceCallbackJwt(wrongAudience)).rejects.toThrow();
  });

  it('rejects an expired token', async () => {
    const token = await signPayload({}, { expired: true });
    await expect(verifyBigCommerceCallbackJwt(token)).rejects.toThrow();
  });

  it('rejects a payload missing required claims', async () => {
    const now = Math.floor(Date.now() / 1000);
    const token = await new SignJWT({ sub: 'stores/abc123' })
      .setProtectedHeader({ alg: 'HS256' })
      .setIssuer('bc')
      .setAudience(CLIENT_ID)
      .setIssuedAt(now)
      .setExpirationTime(now + 300)
      .sign(SECRET_BYTES);

    await expect(verifyBigCommerceCallbackJwt(token)).rejects.toThrow();
  });

  it('rejects an unparseable token string', async () => {
    await expect(verifyBigCommerceCallbackJwt('not-a-jwt')).rejects.toThrow();
  });
});

describe('requireStoreHash', () => {
  it('extracts the store hash from a stores/{hash} context', async () => {
    const token = await signPayload();
    const payload = await verifyBigCommerceCallbackJwt(token);
    expect(requireStoreHash(payload)).toBe('abc123');
  });
});
