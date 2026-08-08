export interface NormalizedKickflipDesign {
  externalId: string;
  numericDesignId: number | null;
  productId: string | null;
  customizerProductId: string | null;
  name: string;
  /** Decimal string (e.g. "24.99") — never a JS float. */
  price: string;
  currencyCode: string | null;
  createdAt: Date | null;
  updatedAt: Date | null;
  primaryImageUrl: string | null;
  imageUrls: string[];
  summary: Array<{ label: string; value: string }>;
  /** Deterministic hash of the import-relevant fields above, used for change detection. */
  rawFingerprint: string;
}

export interface KickflipDesignsPage {
  items: NormalizedKickflipDesign[];
  nextCursor: string | null;
}

export interface ListDesignsParams {
  cursor?: string | null;
  limit: number;
  search?: string;
  signal?: AbortSignal;
  correlationId: string;
}

export interface KickflipCredentials {
  tenantId: string;
  apiToken: string;
}

export interface TestConnectionResult {
  ok: true;
  verifiedAt: Date;
}
