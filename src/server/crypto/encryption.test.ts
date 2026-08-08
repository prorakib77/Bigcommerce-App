import { describe, expect, it } from 'vitest';
import { randomBytes } from 'node:crypto';
import { decryptSecret, DecryptionError, encryptSecret, maskSecret } from './encryption';

const KEY = randomBytes(32);

describe('encryptSecret / decryptSecret', () => {
  it('round-trips a plaintext value', () => {
    const envelope = encryptSecret('super-secret-token', KEY);
    expect(decryptSecret(envelope, KEY)).toBe('super-secret-token');
  });

  it('produces a versioned, dot-delimited envelope', () => {
    const envelope = encryptSecret('value', KEY);
    const parts = envelope.split('.');
    expect(parts).toHaveLength(4);
    expect(parts[0]).toBe('v1');
  });

  it('uses a random nonce on every call, so the same plaintext encrypts differently each time', () => {
    const a = encryptSecret('same-value', KEY);
    const b = encryptSecret('same-value', KEY);
    expect(a).not.toBe(b);
  });

  it('throws DecryptionError when the ciphertext is tampered with', () => {
    const envelope = encryptSecret('value', KEY);
    const [version, iv, tag, ciphertext] = envelope.split('.');
    const tamperedByte = Buffer.from(ciphertext!, 'base64');
    tamperedByte[0] = (tamperedByte[0]! + 1) % 256;
    const tampered = [version, iv, tag, tamperedByte.toString('base64')].join('.');

    expect(() => decryptSecret(tampered, KEY)).toThrow(DecryptionError);
  });

  it('throws DecryptionError when decrypted with the wrong key', () => {
    const envelope = encryptSecret('value', KEY);
    const wrongKey = randomBytes(32);
    expect(() => decryptSecret(envelope, wrongKey)).toThrow(DecryptionError);
  });

  it('throws DecryptionError for a malformed envelope', () => {
    expect(() => decryptSecret('not-a-valid-envelope', KEY)).toThrow(DecryptionError);
  });

  it('throws DecryptionError for an unrecognized version prefix', () => {
    const envelope = encryptSecret('value', KEY);
    const parts = envelope.split('.');
    parts[0] = 'v99';
    expect(() => decryptSecret(parts.join('.'), KEY)).toThrow(DecryptionError);
  });
});

describe('maskSecret', () => {
  it('shows only the last few characters', () => {
    expect(maskSecret('abcd1234efgh5678')).toBe('••••••••5678');
  });

  it('fully masks short values without leaking length details beyond a fixed minimum', () => {
    expect(maskSecret('ab')).toBe('••••');
  });
});
