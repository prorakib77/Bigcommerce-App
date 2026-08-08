import { describe, expect, it } from 'vitest';
import { envSchema, refineEnv } from './schema';

const validKey32 = Buffer.alloc(32, 1).toString('base64');
const validKey48 = Buffer.alloc(48, 2).toString('base64');

function baseEnv(overrides: Record<string, string> = {}) {
  return {
    APP_BASE_URL: 'https://example.com',
    BIGCOMMERCE_AUTH_CALLBACK_URL: 'https://example.com/api/bigcommerce/auth',
    BIGCOMMERCE_LOAD_CALLBACK_URL: 'https://example.com/api/bigcommerce/load',
    BIGCOMMERCE_UNINSTALL_CALLBACK_URL: 'https://example.com/api/bigcommerce/uninstall',
    BIGCOMMERCE_REMOVE_USER_CALLBACK_URL: 'https://example.com/api/bigcommerce/remove-user',
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
    MASTER_ENCRYPTION_KEY: validKey32,
    APP_SESSION_SIGNING_KEY: validKey48,
    BIGCOMMERCE_CLIENT_ID: 'real_client_id',
    BIGCOMMERCE_CLIENT_SECRET: 'real_client_secret',
    ...overrides,
  };
}

describe('envSchema', () => {
  it('parses a minimal valid development environment', () => {
    const result = envSchema.safeParse(baseEnv({ NODE_ENV: 'development' }));
    expect(result.success).toBe(true);
  });

  it('defaults NODE_ENV to development and MOCK_MODE to false', () => {
    const result = envSchema.parse(baseEnv());
    expect(result.NODE_ENV).toBe('development');
    expect(result.MOCK_MODE).toBe(false);
  });

  it('splits KICKFLIP_ALLOWED_IMAGE_HOSTS on commas and lowercases them', () => {
    const result = envSchema.parse(
      baseEnv({ KICKFLIP_ALLOWED_IMAGE_HOSTS: 'CDN.Example.com, images.example.com ' }),
    );
    expect(result.KICKFLIP_ALLOWED_IMAGE_HOSTS).toEqual(['cdn.example.com', 'images.example.com']);
  });

  it('rejects a non-URL APP_BASE_URL', () => {
    const result = envSchema.safeParse(baseEnv({ APP_BASE_URL: 'not-a-url' }));
    expect(result.success).toBe(false);
  });
});

describe('refineEnv', () => {
  it('rejects a MASTER_ENCRYPTION_KEY that does not decode to 32 bytes', () => {
    const parsed = envSchema.parse(
      baseEnv({ MASTER_ENCRYPTION_KEY: Buffer.alloc(16).toString('base64') }),
    );
    const issues = refineEnv(parsed);
    expect(issues.some((i) => i.path === 'MASTER_ENCRYPTION_KEY')).toBe(true);
  });

  it('rejects an APP_SESSION_SIGNING_KEY shorter than 32 bytes', () => {
    const parsed = envSchema.parse(
      baseEnv({ APP_SESSION_SIGNING_KEY: Buffer.alloc(10).toString('base64') }),
    );
    const issues = refineEnv(parsed);
    expect(issues.some((i) => i.path === 'APP_SESSION_SIGNING_KEY')).toBe(true);
  });

  it('rejects MOCK_MODE=true when NODE_ENV=production', () => {
    const parsed = envSchema.parse(baseEnv({ NODE_ENV: 'production', MOCK_MODE: 'true' }));
    const issues = refineEnv(parsed);
    expect(issues.some((i) => i.path === 'MOCK_MODE')).toBe(true);
  });

  it('rejects a non-HTTPS APP_BASE_URL in production', () => {
    const parsed = envSchema.parse(
      baseEnv({
        NODE_ENV: 'production',
        APP_BASE_URL: 'http://example.com',
        BIGCOMMERCE_AUTH_CALLBACK_URL: 'http://example.com/api/bigcommerce/auth',
        BIGCOMMERCE_LOAD_CALLBACK_URL: 'http://example.com/api/bigcommerce/load',
        BIGCOMMERCE_UNINSTALL_CALLBACK_URL: 'http://example.com/api/bigcommerce/uninstall',
        BIGCOMMERCE_REMOVE_USER_CALLBACK_URL: 'http://example.com/api/bigcommerce/remove-user',
      }),
    );
    const issues = refineEnv(parsed);
    expect(issues.some((i) => i.path === 'APP_BASE_URL')).toBe(true);
  });

  it('rejects placeholder BigCommerce credentials in production', () => {
    const parsed = envSchema.parse(
      baseEnv({ NODE_ENV: 'production', BIGCOMMERCE_CLIENT_ID: '', BIGCOMMERCE_CLIENT_SECRET: '' }),
    );
    const issues = refineEnv(parsed);
    expect(issues.some((i) => i.path === 'BIGCOMMERCE_CLIENT_ID')).toBe(true);
    expect(issues.some((i) => i.path === 'BIGCOMMERCE_CLIENT_SECRET')).toBe(true);
  });

  it('requires real BigCommerce credentials outside mock mode even in development', () => {
    const parsed = envSchema.parse(
      baseEnv({ NODE_ENV: 'development', MOCK_MODE: 'false', BIGCOMMERCE_CLIENT_ID: 'changeme' }),
    );
    const issues = refineEnv(parsed);
    expect(issues.some((i) => i.path === 'BIGCOMMERCE_CLIENT_ID')).toBe(true);
  });

  it('allows placeholder BigCommerce credentials when MOCK_MODE is enabled', () => {
    const parsed = envSchema.parse(
      baseEnv({
        NODE_ENV: 'development',
        MOCK_MODE: 'true',
        BIGCOMMERCE_CLIENT_ID: '',
        BIGCOMMERCE_CLIENT_SECRET: '',
      }),
    );
    const issues = refineEnv(parsed);
    expect(issues).toHaveLength(0);
  });

  it('produces no issues for a fully valid production environment', () => {
    const parsed = envSchema.parse(baseEnv({ NODE_ENV: 'production' }));
    expect(refineEnv(parsed)).toHaveLength(0);
  });
});
