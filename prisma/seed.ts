import 'dotenv/config';
import { prisma } from '@/server/db/prisma';
import { getOrCreateStoreSettings } from '@/repositories/settings-repository';

/**
 * Seeds a local development database with a single mock-mode-friendly
 * store so `pnpm dev` has something to load against without going through
 * a real BigCommerce OAuth install first. Safe to run repeatedly
 * (idempotent upserts). Never run against production.
 *
 * Uses the app's own `prisma` singleton (not a hand-rolled client) so this
 * works against whichever backend `DATABASE_URL` selects — Postgres or the
 * local-dev-only SQLite path (see docs/architecture.md#sqlite-local-dev-path)
 * — and goes through `getOrCreateStoreSettings` rather than a raw
 * `storeSettings.create` so `defaultCategoryIds` is written in whichever
 * shape (`Int[]` vs JSON string) that backend actually needs.
 */
async function main(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to run the seed script against NODE_ENV=production');
  }

  // BigCommerce store hashes are alphanumeric only (see
  // src/lib/bigcommerce/schemas.ts's STORE_CONTEXT_PATTERN) — no hyphens.
  const storeHash = 'devstore1';

  const store = await prisma.store.upsert({
    where: { storeHash },
    update: { isActive: true, uninstalledAt: null },
    create: {
      storeHash,
      accountUuid: '00000000-0000-4000-8000-000000000000',
      platformContext: `stores/${storeHash}`,
      // Placeholder envelope — not decryptable, only used so read paths have
      // a non-null value to mask. Replace via a real OAuth install or the
      // Settings page before attempting any live BigCommerce API call.
      encryptedAccessToken: 'v1.AAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAA.AAAA',
      scope: 'store_v2_products',
      ownerBigcommerceUserId: '1000',
      ownerEmail: 'merchant@example.com',
      isActive: true,
    },
  });

  await prisma.storeUser.upsert({
    where: { storeId_bigcommerceUserId: { storeId: store.id, bigcommerceUserId: '1000' } },
    update: { isActive: true, removedAt: null },
    create: {
      storeId: store.id,
      bigcommerceUserId: '1000',
      email: 'merchant@example.com',
      role: 'OWNER',
      isActive: true,
    },
  });

  await getOrCreateStoreSettings(store.id);

  await prisma.kickflipConnection.upsert({
    where: { storeId: store.id },
    update: {},
    create: {
      storeId: store.id,
      tenantId: 'demo-tenant',
      status: 'NOT_CONFIGURED',
    },
  });

  console.log(`Seeded development store "${storeHash}" (id: ${store.id}).`);
  await prisma.$disconnect();
}

main().catch((error: unknown) => {
  console.error('Seed failed:', error);
  process.exit(1);
});
