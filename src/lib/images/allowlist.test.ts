import { describe, expect, it } from 'vitest';
import { isAllowedImageHost, parseAndValidateImageUrl } from './allowlist';

const ALLOWED = ['cdn.mycustomizer.com', 'images.mycustomizer.com'];

describe('isAllowedImageHost', () => {
  it('allows an exact match', () => {
    expect(isAllowedImageHost('cdn.mycustomizer.com', ALLOWED)).toBe(true);
  });

  it('is case-insensitive', () => {
    expect(isAllowedImageHost('CDN.MyCustomizer.com', ALLOWED)).toBe(true);
  });

  it('rejects a subdomain of an allowed host that is not itself listed', () => {
    expect(isAllowedImageHost('evil.cdn.mycustomizer.com', ALLOWED)).toBe(false);
  });

  it('rejects the bare parent domain when only a subdomain is allowed', () => {
    expect(isAllowedImageHost('mycustomizer.com', ALLOWED)).toBe(false);
  });

  it('rejects a lookalike host', () => {
    expect(isAllowedImageHost('cdn.mycustomizer.com.evil.com', ALLOWED)).toBe(false);
  });

  it('rejects everything when the allowlist is empty (default-deny)', () => {
    expect(isAllowedImageHost('cdn.mycustomizer.com', [])).toBe(false);
  });
});

describe('parseAndValidateImageUrl', () => {
  it('allows an HTTPS URL on the allowlist', () => {
    const { allowed } = parseAndValidateImageUrl('https://cdn.mycustomizer.com/a.jpg', ALLOWED);
    expect(allowed).toBe(true);
  });

  it('rejects a plain HTTP URL even on an allowed host', () => {
    const { allowed } = parseAndValidateImageUrl('http://cdn.mycustomizer.com/a.jpg', ALLOWED);
    expect(allowed).toBe(false);
  });

  it('rejects a host not on the allowlist', () => {
    const { allowed } = parseAndValidateImageUrl('https://evil.com/a.jpg', ALLOWED);
    expect(allowed).toBe(false);
  });

  it('throws for a malformed URL rather than silently returning not-allowed', () => {
    expect(() => parseAndValidateImageUrl('not a url', ALLOWED)).toThrow();
  });
});
