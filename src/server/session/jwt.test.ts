import { describe, expect, it } from 'vitest';
import { randomUUID } from 'node:crypto';
import { signSessionJwt, verifySessionJwt, SessionJwtError, type SessionClaims } from './jwt';

function claims(overrides: Partial<SessionClaims> = {}): SessionClaims {
  return {
    sid: 'session_1',
    storeId: 'store_1',
    storeUserId: 'user_1',
    bigcommerceUserId: '1000',
    role: 'OWNER',
    jti: randomUUID(),
    ...overrides,
  };
}

describe('signSessionJwt / verifySessionJwt', () => {
  it('round-trips claims through sign and verify', async () => {
    const input = claims();
    const token = await signSessionJwt(input, 900);
    const verified = await verifySessionJwt(token);
    expect(verified).toEqual(input);
  });

  it('rejects an expired token with reason "expired"', async () => {
    const token = await signSessionJwt(claims(), -1);
    await expect(verifySessionJwt(token)).rejects.toMatchObject({
      name: 'SessionJwtError',
      reason: 'expired',
    });
  });

  it('rejects a tampered token with reason "invalid"', async () => {
    const token = await signSessionJwt(claims(), 900);
    const tampered = `${token.slice(0, -4)}abcd`;
    await expect(verifySessionJwt(tampered)).rejects.toBeInstanceOf(SessionJwtError);
    await expect(verifySessionJwt(tampered)).rejects.toMatchObject({ reason: 'invalid' });
  });

  it('rejects a payload missing required claims', async () => {
    // Sign a token missing `role` by going around the typed helper isn't
    // possible without duplicating signing logic, so instead verify that a
    // structurally different (but validly signed) JWT is rejected.
    const token = await signSessionJwt(
      claims({ role: undefined as unknown as SessionClaims['role'] }),
      900,
    );
    await expect(verifySessionJwt(token)).rejects.toThrow();
  });
});
