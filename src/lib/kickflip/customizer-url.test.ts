import { describe, expect, it } from 'vitest';
import { buildKickflipCustomizerUrl, extractCustomizeUrl } from './customizer-url';

describe('buildKickflipCustomizerUrl', () => {
  it('substitutes the token into the template', () => {
    expect(buildKickflipCustomizerUrl('abc123', 'https://customizer.example.com/embed/{customizerProductId}')).toBe(
      'https://customizer.example.com/embed/abc123',
    );
  });

  it('returns null when customizerProductId is null', () => {
    expect(buildKickflipCustomizerUrl(null, 'https://example.com/{customizerProductId}')).toBeNull();
  });

  it('returns null when the template is empty', () => {
    expect(buildKickflipCustomizerUrl('abc123', '')).toBeNull();
  });

  it('returns null when the template does not contain the token', () => {
    expect(buildKickflipCustomizerUrl('abc123', 'https://example.com/no-token-here')).toBeNull();
  });

  it('URL-encodes the substituted id', () => {
    expect(buildKickflipCustomizerUrl('a b/c', 'https://example.com/{customizerProductId}')).toBe(
      'https://example.com/a%20b%2Fc',
    );
  });

  it('replaces every occurrence of the token', () => {
    expect(
      buildKickflipCustomizerUrl('42', 'https://example.com/{customizerProductId}?ref={customizerProductId}'),
    ).toBe('https://example.com/42?ref=42');
  });
});

describe('extractCustomizeUrl', () => {
  it('returns a bare URL unchanged', () => {
    expect(extractCustomizeUrl('https://example.com/customize')).toBe(
      'https://example.com/customize',
    );
  });

  it('extracts the src from a pasted iframe tag (double quotes)', () => {
    expect(extractCustomizeUrl('<iframe src="https://example.com/customize"></iframe>')).toBe(
      'https://example.com/customize',
    );
  });

  it('extracts the src from a pasted iframe tag (single quotes)', () => {
    expect(extractCustomizeUrl("<iframe src='https://example.com/customize'></iframe>")).toBe(
      'https://example.com/customize',
    );
  });

  it('extracts the src regardless of other attribute order', () => {
    expect(
      extractCustomizeUrl(
        '<iframe width="100%" height="600" src="https://example.com/customize" frameborder="0"></iframe>',
      ),
    ).toBe('https://example.com/customize');
  });

  it('trims surrounding whitespace on a bare URL', () => {
    expect(extractCustomizeUrl('  https://example.com/customize  ')).toBe(
      'https://example.com/customize',
    );
  });
});
