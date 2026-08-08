import { describe, expect, it } from 'vitest';
import { detectImageTypeFromBytes, isSupportedDeclaredType } from './content-type';

const JPEG = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0, 0, 0, 0, 0, 0, 0, 0]);
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 0]);
const GIF = Buffer.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 0, 0, 0, 0, 0, 0]);
const WEBP = Buffer.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]);

describe('detectImageTypeFromBytes', () => {
  it('detects JPEG from its magic bytes', () => {
    expect(detectImageTypeFromBytes(JPEG)).toBe('image/jpeg');
  });
  it('detects PNG from its magic bytes', () => {
    expect(detectImageTypeFromBytes(PNG)).toBe('image/png');
  });
  it('detects GIF from its magic bytes', () => {
    expect(detectImageTypeFromBytes(GIF)).toBe('image/gif');
  });
  it('detects WEBP from its magic bytes', () => {
    expect(detectImageTypeFromBytes(WEBP)).toBe('image/webp');
  });

  it('returns null for a file with a .jpg-like name but non-image content', () => {
    const fakeJpeg = Buffer.from('this is not actually an image, just text padded out'.padEnd(20));
    expect(detectImageTypeFromBytes(fakeJpeg)).toBeNull();
  });

  it('returns null for an SVG (deliberately unsupported — can contain scripts)', () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>'.padEnd(20));
    expect(detectImageTypeFromBytes(svg)).toBeNull();
  });

  it('returns null for a buffer too short to contain a valid signature', () => {
    expect(detectImageTypeFromBytes(Buffer.from([0xff, 0xd8]))).toBeNull();
  });
});

describe('isSupportedDeclaredType', () => {
  it('accepts known image content types', () => {
    expect(isSupportedDeclaredType('image/jpeg')).toBe(true);
    expect(isSupportedDeclaredType('image/png; charset=binary')).toBe(true);
  });

  it('rejects an SVG content type', () => {
    expect(isSupportedDeclaredType('image/svg+xml')).toBe(false);
  });

  it('rejects a non-image content type', () => {
    expect(isSupportedDeclaredType('text/html')).toBe(false);
  });

  it('rejects a null content type', () => {
    expect(isSupportedDeclaredType(null)).toBe(false);
  });
});
