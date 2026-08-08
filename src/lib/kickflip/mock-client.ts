import { AppError } from '@/server/errors/app-error';
import { normalizeDesign } from './mapper';
import type {
  KickflipCredentials,
  KickflipDesignsPage,
  ListDesignsParams,
  NormalizedKickflipDesign,
  TestConnectionResult,
} from './types';
import type { ListDesignsResult } from './client';

/**
 * Deterministic fixture data for development/CI without real Kickflip
 * credentials. Special tenant IDs (configured on the Settings page in mock
 * mode) simulate specific failure modes so the UI's error/loading/retry
 * states can be exercised end-to-end. See README "Mock mode".
 */
const MOCK_TENANTS = {
  EXPIRED_AUTH: 'mock-expired-auth',
  RATE_LIMITED: 'mock-rate-limited',
  SERVER_ERROR: 'mock-server-error',
};

function buildRawFixtures(): unknown[] {
  const fixtures: unknown[] = [];
  for (let i = 1; i <= 24; i += 1) {
    fixtures.push({
      designId: `design-${i}`,
      productId: `product-${i}`,
      customizerProductId: `cust-product-${(i % 3) + 1}`,
      name: `Custom Tee — Pattern ${i}`,
      price: (19.99 + i).toFixed(2),
      currencyCode: 'USD',
      createdAt: new Date(Date.UTC(2026, 0, i)).toISOString(),
      updatedAt: new Date(Date.UTC(2026, 1, i)).toISOString(),
      primaryImage: `https://cdn.mycustomizer.com/fixtures/design-${i}/primary.jpg`,
      images: [
        `https://cdn.mycustomizer.com/fixtures/design-${i}/primary.jpg`,
        `https://cdn.mycustomizer.com/fixtures/design-${i}/back.jpg`,
      ],
      options: [
        { label: 'Color', value: i % 2 === 0 ? 'Navy' : 'Heather Grey' },
        { label: 'Size', value: 'M' },
        { label: 'Print placement', value: 'Front + Back' },
      ],
    });
  }

  // One deliberately malformed record (no price) to exercise skip-and-continue.
  fixtures.push({ designId: 'design-malformed-1', name: 'Missing price design' });

  return fixtures;
}

const RAW_FIXTURES = buildRawFixtures();
const PAGE_SIZE_DEFAULT = 10;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export class MockKickflipClient {
  constructor(private readonly credentials: KickflipCredentials) {}

  private assertNotSimulatingFailure(): void {
    if (this.credentials.tenantId === MOCK_TENANTS.EXPIRED_AUTH) {
      throw new AppError('KICKFLIP_AUTH_FAILED');
    }
    if (this.credentials.tenantId === MOCK_TENANTS.RATE_LIMITED) {
      throw new AppError('KICKFLIP_RATE_LIMITED');
    }
    if (this.credentials.tenantId === MOCK_TENANTS.SERVER_ERROR) {
      throw new AppError('KICKFLIP_API_UNAVAILABLE');
    }
  }

  async testConnection(): Promise<TestConnectionResult> {
    await sleep(150);
    this.assertNotSimulatingFailure();
    return { ok: true, verifiedAt: new Date() };
  }

  async listDesigns(params: ListDesignsParams): Promise<ListDesignsResult> {
    await sleep(150);
    this.assertNotSimulatingFailure();

    const limit = Math.min(params.limit, 50) || PAGE_SIZE_DEFAULT;
    const offset = params.cursor ? Number(params.cursor) : 0;
    const slice = RAW_FIXTURES.slice(offset, offset + limit);

    const items: NormalizedKickflipDesign[] = [];
    let skippedCount = 0;
    for (const raw of slice) {
      const result = normalizeDesign(raw);
      if (result.ok) {
        items.push(result.design);
      } else {
        skippedCount += 1;
      }
    }

    const nextOffset = offset + limit;
    const nextCursor = nextOffset < RAW_FIXTURES.length ? String(nextOffset) : null;

    const page: KickflipDesignsPage = { items, nextCursor };
    return { page, skippedCount };
  }

  async getDesign(designId: string): Promise<NormalizedKickflipDesign> {
    await sleep(100);
    this.assertNotSimulatingFailure();
    const raw = RAW_FIXTURES.find((item) => (item as { designId?: string }).designId === designId);
    if (!raw) throw new AppError('KICKFLIP_DESIGN_NOT_FOUND');
    const result = normalizeDesign(raw);
    if (!result.ok) throw new AppError('KICKFLIP_SCHEMA_MISMATCH');
    return result.design;
  }
}

export { MOCK_TENANTS };
