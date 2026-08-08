import { prisma } from '@/server/db/prisma';

const APP_TABLES = [
  'audit_logs',
  'app_sessions',
  'one_time_tokens',
  'import_runs',
  'import_mappings',
  'product_customize_configs',
  'store_settings',
  'kickflip_connections',
  'store_users',
  'stores',
];

/** Truncates every application table (not pg-boss's own schema) between integration tests. */
export async function resetDatabase(): Promise<void> {
  await prisma.$executeRawUnsafe(
    `TRUNCATE TABLE ${APP_TABLES.join(', ')} RESTART IDENTITY CASCADE`,
  );
}
