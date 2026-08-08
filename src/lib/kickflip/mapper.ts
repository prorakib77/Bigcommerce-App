import { sha256Hex } from '@/server/crypto/hash';
import { rawKickflipDesignSchema, type RawKickflipDesign } from './schemas';
import type { NormalizedKickflipDesign } from './types';

const DECIMAL_STRING_PATTERN = /^\d+(\.\d{1,4})?$/;

export type NormalizeResult =
  | { ok: true; design: NormalizedKickflipDesign }
  | { ok: false; externalId: string | null; reason: string };

function normalizePrice(raw: RawKickflipDesign['price']): string | null {
  if (raw == null) return null;
  if (typeof raw === 'string') {
    return DECIMAL_STRING_PATTERN.test(raw.trim()) ? raw.trim() : null;
  }
  if (typeof raw === 'number' && Number.isFinite(raw) && raw >= 0) {
    // Single, direct format of an already-parsed JSON number — not an
    // arithmetic operation, so this does not compound floating-point error.
    return raw.toFixed(2);
  }
  return null;
}

function normalizeImageUrl(raw: RawKickflipDesign['primaryImage']): string | null {
  if (!raw) return null;
  if (typeof raw === 'string') return raw;
  return typeof raw.url === 'string' ? raw.url : null;
}

function normalizeImageList(raw: RawKickflipDesign['images']): string[] {
  if (!raw) return [];
  return raw.map((entry) => normalizeImageUrl(entry)).filter((url): url is string => Boolean(url));
}

function normalizeDate(raw: string | null | undefined): Date | null {
  if (!raw) return null;
  const date = new Date(raw);
  return Number.isNaN(date.getTime()) ? null : date;
}

/**
 * Converts one raw Kickflip design record into the app's normalized model.
 * Never throws — returns a discriminated result so a single malformed
 * record can be skipped (and surfaced as a schema-mismatch notice) without
 * failing the entire page of results.
 */
export function normalizeDesign(raw: unknown): NormalizeResult {
  const parsed = rawKickflipDesignSchema.safeParse(raw);
  if (!parsed.success) {
    return { ok: false, externalId: null, reason: 'Record did not match the expected shape' };
  }
  const record = parsed.data;

  const externalId = String(record.designId).trim();
  if (!externalId) {
    return { ok: false, externalId: null, reason: 'Missing a stable design identifier' };
  }

  const price = normalizePrice(record.price);
  if (price === null) {
    return { ok: false, externalId, reason: 'Missing or invalid price' };
  }

  const imageUrls = normalizeImageList(record.images);
  const primaryImageUrl = normalizeImageUrl(record.primaryImage) ?? imageUrls[0] ?? null;
  const summary = (record.options ?? []).map((opt) => ({ label: opt.label, value: opt.value }));
  const numericDesignId =
    typeof record.designId === 'number'
      ? record.designId
      : Number.isInteger(Number(record.designId))
        ? Number(record.designId)
        : null;

  const name = record.name?.trim() || `Kickflip design ${externalId}`;
  const currencyCode = record.currencyCode ?? record.currency ?? null;
  const createdAt = normalizeDate(record.createdAt);
  const updatedAt = normalizeDate(record.updatedAt);

  const fingerprintSource = JSON.stringify({
    name,
    price,
    currencyCode,
    imageUrls,
    summary,
    updatedAt: updatedAt?.toISOString() ?? null,
  });

  const design: NormalizedKickflipDesign = {
    externalId,
    numericDesignId,
    productId: record.productId != null ? String(record.productId) : null,
    customizerProductId:
      record.customizerProductId != null ? String(record.customizerProductId) : null,
    name,
    price,
    currencyCode,
    createdAt,
    updatedAt,
    primaryImageUrl,
    imageUrls,
    summary,
    rawFingerprint: sha256Hex(fingerprintSource),
  };

  return { ok: true, design };
}
