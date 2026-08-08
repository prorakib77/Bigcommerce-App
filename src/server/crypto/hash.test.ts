import { describe, expect, it } from 'vitest';
import { timingSafeEqualStrings } from './hash';

describe('timingSafeEqualStrings', () => {
  it('returns true for identical strings', () => {
    expect(timingSafeEqualStrings('same-secret-value', 'same-secret-value')).toBe(true);
  });

  it('returns false for different strings of the same length', () => {
    expect(timingSafeEqualStrings('secret-value-aaaa', 'secret-value-bbbb')).toBe(false);
  });

  it('returns false for different-length strings without throwing', () => {
    expect(() => timingSafeEqualStrings('short', 'a-much-longer-value')).not.toThrow();
    expect(timingSafeEqualStrings('short', 'a-much-longer-value')).toBe(false);
  });

  it('returns false when either side is null', () => {
    expect(timingSafeEqualStrings(null, 'value')).toBe(false);
    expect(timingSafeEqualStrings('value', null)).toBe(false);
    expect(timingSafeEqualStrings(null, null)).toBe(false);
  });

  it('returns false when either side is undefined', () => {
    expect(timingSafeEqualStrings(undefined, 'value')).toBe(false);
    expect(timingSafeEqualStrings('value', undefined)).toBe(false);
  });

  it('returns false when either side is an empty string', () => {
    expect(timingSafeEqualStrings('', 'value')).toBe(false);
    expect(timingSafeEqualStrings('value', '')).toBe(false);
  });
});
