// NODE_ENV is already "test" under Vitest.
process.env.LOG_LEVEL ||= 'silent';
process.env.APP_BASE_URL ||= 'http://localhost:3000';
process.env.BIGCOMMERCE_AUTH_CALLBACK_URL ||= 'http://localhost:3000/api/bigcommerce/auth';
process.env.BIGCOMMERCE_LOAD_CALLBACK_URL ||= 'http://localhost:3000/api/bigcommerce/load';
process.env.BIGCOMMERCE_UNINSTALL_CALLBACK_URL ||=
  'http://localhost:3000/api/bigcommerce/uninstall';
process.env.BIGCOMMERCE_REMOVE_USER_CALLBACK_URL ||=
  'http://localhost:3000/api/bigcommerce/remove-user';
process.env.BIGCOMMERCE_CLIENT_ID ||= 'test_client_id';
process.env.BIGCOMMERCE_CLIENT_SECRET ||= 'test_client_secret';
process.env.MASTER_ENCRYPTION_KEY ||= Buffer.alloc(32, 7).toString('base64');
process.env.APP_SESSION_SIGNING_KEY ||= Buffer.alloc(48, 9).toString('base64');
process.env.KICKFLIP_ALLOWED_IMAGE_HOSTS ||= 'cdn.mycustomizer.com,images.mycustomizer.com';
// Integration tests exercise the Kickflip/BigCommerce adapters through
// their mock implementations rather than real network calls — MOCK_MODE
// selects those at the factory level (see src/lib/kickflip and
// src/lib/bigcommerce/catalog-service.ts). The BigCommerce OAuth flow
// itself is still exercised for real (against an MSW-mocked HTTP layer),
// since MOCK_MODE only affects the Kickflip/catalog client factories.
process.env.MOCK_MODE ||= 'true';

const testDatabaseUrl =
  process.env.TEST_DATABASE_URL ||
  process.env.DATABASE_URL ||
  'postgresql://kickflip_app_test:changeme@localhost:5545/kickflip_app_test?schema=public';

if (!/test/i.test(testDatabaseUrl)) {
  throw new Error(
    `Refusing to run integration tests against a database whose name doesn't look like a test database: ${testDatabaseUrl}`,
  );
}

process.env.DATABASE_URL = testDatabaseUrl;
process.env.DIRECT_DATABASE_URL = testDatabaseUrl;
