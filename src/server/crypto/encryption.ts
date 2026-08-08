import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';
import { getEnv } from '@/server/env';

/**
 * Versioned authenticated-encryption envelope for secrets at rest
 * (BigCommerce access tokens, Kickflip API tokens).
 *
 * Format (all binary components base64-encoded, joined with "."):
 *   v1.<iv>.<authTag>.<ciphertext>
 *
 * The version prefix lets us roll the algorithm or key-derivation scheme in
 * the future without breaking decryption of previously stored values.
 */
const ENVELOPE_VERSION = 'v1';
const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH_BYTES = 12;

export class DecryptionError extends Error {
  constructor(message = 'Failed to decrypt payload: ciphertext or key is invalid') {
    super(message);
    this.name = 'DecryptionError';
  }
}

function getMasterKey(): Buffer {
  const key = Buffer.from(getEnv().MASTER_ENCRYPTION_KEY, 'base64');
  if (key.length !== 32) {
    throw new Error('MASTER_ENCRYPTION_KEY must decode to exactly 32 bytes');
  }
  return key;
}

/**
 * Encrypts plaintext with AES-256-GCM using a fresh random 96-bit nonce for
 * every call. Never reuse a nonce with the same key.
 */
export function encryptSecret(plaintext: string, key: Buffer = getMasterKey()): string {
  const iv = randomBytes(IV_LENGTH_BYTES);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();

  return [
    ENVELOPE_VERSION,
    iv.toString('base64'),
    authTag.toString('base64'),
    ciphertext.toString('base64'),
  ].join('.');
}

/**
 * Decrypts a payload produced by `encryptSecret`. Throws `DecryptionError`
 * if the envelope is malformed, the version is unrecognized, or GCM
 * authentication fails (tampered ciphertext, wrong key, wrong nonce).
 */
export function decryptSecret(envelope: string, key: Buffer = getMasterKey()): string {
  const parts = envelope.split('.');
  if (parts.length !== 4) {
    throw new DecryptionError('Malformed encrypted payload: unexpected part count');
  }

  const [version, ivB64, authTagB64, ciphertextB64] = parts as [string, string, string, string];
  if (version !== ENVELOPE_VERSION) {
    throw new DecryptionError(`Unsupported encryption envelope version: ${version}`);
  }

  try {
    const iv = Buffer.from(ivB64, 'base64');
    const authTag = Buffer.from(authTagB64, 'base64');
    const ciphertext = Buffer.from(ciphertextB64, 'base64');

    const decipher = createDecipheriv(ALGORITHM, key, iv);
    decipher.setAuthTag(authTag);
    const plaintext = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    return plaintext.toString('utf8');
  } catch {
    throw new DecryptionError();
  }
}

/** Returns the last N characters of a secret for safe display (e.g. "••••abcd"). */
export function maskSecret(plaintext: string, visibleChars = 4): string {
  if (plaintext.length <= visibleChars) {
    return '•'.repeat(Math.max(plaintext.length, 4));
  }
  return `${'•'.repeat(8)}${plaintext.slice(-visibleChars)}`;
}
