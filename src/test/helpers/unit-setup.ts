import '@testing-library/jest-dom/vitest';

// NODE_ENV is already "test" under Vitest; everything else here fills in
// values the env schema requires that a unit test has no reason to set itself.
process.env.APP_BASE_URL ||= 'http://localhost:3000';
process.env.BIGCOMMERCE_AUTH_CALLBACK_URL ||= 'http://localhost:3000/api/bigcommerce/auth';
process.env.BIGCOMMERCE_LOAD_CALLBACK_URL ||= 'http://localhost:3000/api/bigcommerce/load';
process.env.BIGCOMMERCE_UNINSTALL_CALLBACK_URL ||=
  'http://localhost:3000/api/bigcommerce/uninstall';
process.env.BIGCOMMERCE_REMOVE_USER_CALLBACK_URL ||=
  'http://localhost:3000/api/bigcommerce/remove-user';
process.env.BIGCOMMERCE_CLIENT_ID ||= 'test_client_id';
process.env.BIGCOMMERCE_CLIENT_SECRET ||= 'test_client_secret';
process.env.DATABASE_URL ||=
  'postgresql://test:test@localhost:5544/kickflip_app_test?schema=public';
process.env.MASTER_ENCRYPTION_KEY ||= Buffer.alloc(32, 7).toString('base64');
process.env.APP_SESSION_SIGNING_KEY ||= Buffer.alloc(48, 9).toString('base64');
process.env.KICKFLIP_ALLOWED_IMAGE_HOSTS ||= 'cdn.mycustomizer.com,images.mycustomizer.com';
process.env.MOCK_MODE ||= 'false';
