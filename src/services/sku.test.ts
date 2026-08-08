import { describe, expect, it } from 'vitest';
import { generateSku } from './sku';

describe('generateSku', () => {
  it('joins a normalized prefix and design id with a hyphen', () => {
    expect(generateSku('KF', 'design-42')).toBe('KF-design-42');
  });

  it('uppercases and sanitizes the prefix', () => {
    expect(generateSku('kf shop', 'design-42')).toBe('KFSHOP-design-42');
  });

  it('falls back to KF when the prefix is empty', () => {
    expect(generateSku('', 'design-42')).toBe('KF-design-42');
  });

  it('replaces disallowed characters in the design id with hyphens', () => {
    expect(generateSku('KF', 'design_42/variant#1')).toBe('KF-design-42-variant-1');
  });

  it('collapses repeated hyphens produced by sanitization', () => {
    expect(generateSku('KF', 'a///b')).toBe('KF-a-b');
  });

  it('is deterministic for the same inputs', () => {
    expect(generateSku('KF', 'design-42')).toBe(generateSku('KF', 'design-42'));
  });

  it('caps the result length', () => {
    const longId = 'x'.repeat(300);
    expect(generateSku('KF', longId).length).toBeLessThanOrEqual(100);
  });
});
