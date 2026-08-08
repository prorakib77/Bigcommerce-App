import 'dotenv/config';
import { PrismaPg } from '@prisma/adapter-pg';
import { PrismaClient } from '@prisma/client';

/**
 * Seeds a deterministic store/owner/settings/Kickflip-connection for the
 * Playwright E2E suite. Runs once per `webServer` boot (see
 * playwright.config.ts) against a dedicated E2E database — never the
 * developer's local dev database.
 */
async function main(): Promise<void> {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString || !/test/i.test(connectionString)) {
    throw new Error(
      'e2e/seed.ts refuses to run against a database whose URL does not look like a test database',
    );
  }

  const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE audit_logs, app_sessions, one_time_tokens, import_runs, import_mappings, store_settings, kickflip_connections, store_users, stores RESTART IDENTITY CASCADE',
  );

  const store = await prisma.store.create({
    data: {
      // BigCommerce store hashes are alphanumeric only (see
      // src/lib/bigcommerce/schemas.ts's STORE_CONTEXT_PATTERN) — no hyphens.
      storeHash: 'e2estore',
      encryptedAccessToken: 'v1.AAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAA.AAAA',
      scope: 'store_v2_products',
      ownerBigcommerceUserId: '1000',
      ownerEmail: 'owner@example.com',
      isActive: true,
    },
  });

  await prisma.storeUser.create({
    data: {
      storeId: store.id,
      bigcommerceUserId: '1000',
      email: 'owner@example.com',
      role: 'OWNER',
      isActive: true,
    },
  });

  await prisma.storeUser.create({
    data: {
      storeId: store.id,
      bigcommerceUserId: '2000',
      email: 'staff@example.com',
      role: 'USER',
      isActive: true,
    },
  });

  await prisma.storeSettings.create({
    data: {
      storeId: store.id,
      defaultCategoryIds: [],
      defaultProductWeight: 0.5,
      skuPrefix: 'KF',
      defaultVisibility: false,
      importImages: false,
      updateImagesOnReimport: true,
      updateNameOnReimport: true,
      updatePriceOnReimport: true,
      updateDescriptionOnReimport: true,
      maxImagesPerDesign: 8,
    },
  });

  await prisma.kickflipConnection.create({
    data: {
      storeId: store.id,
      tenantId: 'mock-tenant',
      encryptedApiToken: 'v1.AAAAAAAAAAAAAAAA.AAAAAAAAAAAAAAAAAAAAAA.AAAA',
      tokenLastFour: 'oken',
      status: 'CONNECTED',
      lastVerifiedAt: new Date(),
    },
  });

  console.warn(`E2E seed complete: store ${store.storeHash} (${store.id})`);
  await prisma.$disconnect();
}

main().catch((error: unknown) => {
  console.error('E2E seed failed:', error);
  process.exit(1);
});
