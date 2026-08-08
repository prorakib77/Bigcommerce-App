import { describe, expect, it } from 'vitest';
import { isSensitiveKey, redactDeep, redactUrl } from './redaction';

describe('isSensitiveKey', () => {
  it.each([
    'authorization',
    'Authorization',
    'x-auth-token',
    'access_token',
    'accessToken',
    'api_token',
    'client_secret',
    'password',
    'encrypted_token',
    'signed_payload_jwt',
  ])('flags "%s" as sensitive', (key) => {
    expect(isSensitiveKey(key)).toBe(true);
  });

  it.each(['storeId', 'email', 'designId', 'name'])('does not flag "%s" as sensitive', (key) => {
    expect(isSensitiveKey(key)).toBe(false);
  });
});

describe('redactDeep', () => {
  it('replaces sensitive top-level keys with a redaction marker', () => {
    const result = redactDeep({ password: 'hunter2', name: 'ok' });
    expect(result).toEqual({ password: '[REDACTED]', name: 'ok' });
  });

  it('redacts sensitive keys at any depth', () => {
    const result = redactDeep({ user: { profile: { apiToken: 'secret' } } });
    expect(result).toEqual({ user: { profile: { apiToken: '[REDACTED]' } } });
  });

  it('redacts sensitive keys inside arrays of objects', () => {
    const result = redactDeep({ items: [{ clientSecret: 'a' }, { clientSecret: 'b' }] });
    expect(result).toEqual({
      items: [{ clientSecret: '[REDACTED]' }, { clientSecret: '[REDACTED]' }],
    });
  });

  it('leaves non-sensitive nested data untouched', () => {
    const input = { storeId: 'abc', settings: { skuPrefix: 'KF' } };
    expect(redactDeep(input)).toEqual(input);
  });

  it('does not throw on circular references', () => {
    const obj: Record<string, unknown> = { name: 'a' };
    obj.self = obj;
    expect(() => redactDeep(obj)).not.toThrow();
  });
});

describe('redactUrl', () => {
  it('strips the query string from a URL', () => {
    expect(redactUrl('https://cdn.example.com/img.jpg?sig=abc123&exp=999')).toBe(
      'https://cdn.example.com/img.jpg',
    );
  });

  it('strips embedded credentials from a URL', () => {
    expect(redactUrl('https://user:pass@cdn.example.com/img.jpg')).toBe(
      'https://cdn.example.com/img.jpg',
    );
  });

  it('returns a placeholder for an unparseable URL rather than throwing', () => {
    expect(redactUrl('not a url')).toBe('[unparseable-url]');
  });
});
