import { z } from 'zod';

const boolFromString = (defaultValue: 'true' | 'false') =>
  z
    .enum(['true', 'false'])
    .default(defaultValue)
    .transform((value) => value === 'true');

const commaSeparatedHosts = z
  .string()
  .default('')
  .transform((value) =>
    value
      .split(',')
      .map((host) => host.trim().toLowerCase())
      .filter((host) => host.length > 0),
  );

/**
 * Raw shape of every environment variable the application reads. Kept
 * separate from the cross-field refinements below so both web and worker
 * entry points parse the exact same contract.
 */
export const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  APP_BASE_URL: z.url({ message: 'APP_BASE_URL must be a valid absolute URL' }),
  PORT: z.coerce.number().int().positive().default(3000),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),

  BIGCOMMERCE_CLIENT_ID: z.string().default(''),
  BIGCOMMERCE_CLIENT_SECRET: z.string().default(''),
  BIGCOMMERCE_AUTH_CALLBACK_URL: z.url(),
  BIGCOMMERCE_LOAD_CALLBACK_URL: z.url(),
  BIGCOMMERCE_UNINSTALL_CALLBACK_URL: z.url(),
  BIGCOMMERCE_REMOVE_USER_CALLBACK_URL: z.url(),
  // `store_v2_content` (BigCommerce "Content" scope) is required for the
  // Script Manager registration used by the storefront Customize widget
  // (src/lib/bigcommerce/scripts.ts). `store_v2_orders_read_only` is required
  // for the Orders sync webhook (src/lib/bigcommerce/orders.ts). FLAG: both
  // exact scope identifiers are unverified assumptions — confirm against the
  // BigCommerce Developer Portal's OAuth Scopes list before relying on them
  // (see docs/api-assumptions.md).
  BIGCOMMERCE_APP_SCOPES: z
    .string()
    .default('store_v2_products store_v2_content store_v2_orders_read_only')
    .transform((value) =>
      value
        .split(' ')
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  BIGCOMMERCE_LOGIN_BASE_URL: z.url().default('https://login.bigcommerce.com'),
  BIGCOMMERCE_API_BASE_URL: z.url().default('https://api.bigcommerce.com'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DIRECT_DATABASE_URL: z.string().min(1).optional(),

  MASTER_ENCRYPTION_KEY: z.string().min(1, 'MASTER_ENCRYPTION_KEY is required'),
  APP_SESSION_SIGNING_KEY: z.string().min(1, 'APP_SESSION_SIGNING_KEY is required'),
  APP_SESSION_TTL_MINUTES: z.coerce.number().int().min(1).max(60).default(15),

  KICKFLIP_API_BASE_URL: z.url().default('https://api.gokickflip.com/v1'),
  KICKFLIP_ALLOWED_IMAGE_HOSTS: commaSeparatedHosts,
  // A URL *template* (not a bare URL), e.g.
  // `https://customizer.gokickflip.com/embed/{customizerProductId}` — used to
  // suggest (never force) a per-product Customize URL when a product has a
  // known Kickflip customizer product id. FLAG: this pattern is a guess, not
  // confirmed against real Kickflip customizer docs — see
  // docs/api-assumptions.md. Empty string disables the suggestion entirely.
  KICKFLIP_CUSTOMIZER_BASE_URL: z.string().default(''),

  HTTP_CONNECT_TIMEOUT_MS: z.coerce.number().int().positive().default(5000),
  HTTP_REQUEST_TIMEOUT_MS: z.coerce.number().int().positive().default(30000),

  IMPORT_GLOBAL_CONCURRENCY: z.coerce.number().int().positive().default(5),
  IMPORT_PER_STORE_CONCURRENCY: z.coerce.number().int().positive().default(2),
  IMPORT_MAX_ATTEMPTS: z.coerce.number().int().positive().default(5),
  MAX_BATCH_IMPORT_SIZE: z.coerce.number().int().positive().max(500).default(50),
  IMAGE_MAX_BYTES: z.coerce.number().int().positive().default(8_388_608),
  IMAGE_MAX_REDIRECTS: z.coerce.number().int().min(0).default(3),
  IMAGE_MAX_PER_DESIGN: z.coerce.number().int().positive().default(8),

  DATA_RETENTION_DAYS: z.coerce.number().int().positive().default(365),

  RATE_LIMIT_SENSITIVE_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_SENSITIVE_MAX: z.coerce.number().int().positive().default(10),

  // Separate, much looser limits for the public, unauthenticated storefront
  // widget config endpoint (src/app/api/public/storefront/customize-config) —
  // it's hit on ordinary storefront page views, not rare admin actions, so
  // RATE_LIMIT_SENSITIVE_* (tuned for ~10/min) would be far too tight.
  RATE_LIMIT_STOREFRONT_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_STOREFRONT_MAX: z.coerce.number().int().positive().default(120),

  // Rate limit for the public Orders webhook receiver
  // (src/app/api/public/webhooks/bigcommerce/orders), keyed by storeHash
  // rather than caller IP — see that route's own comment for why.
  RATE_LIMIT_WEBHOOK_WINDOW_MS: z.coerce.number().int().positive().default(60_000),
  RATE_LIMIT_WEBHOOK_MAX: z.coerce.number().int().positive().default(60),

  SENTRY_DSN: z.string().optional().default(''),
  OTEL_EXPORTER_OTLP_ENDPOINT: z.string().optional().default(''),

  MOCK_MODE: boolFromString('false'),
});

export type RawEnv = z.infer<typeof envSchema>;

const PLACEHOLDER_VALUES = new Set([
  '',
  'changeme',
  'change-me',
  'secret',
  'test',
  'placeholder',
  'example',
]);

function decodedByteLength(base64Value: string): number {
  try {
    return Buffer.from(base64Value, 'base64').length;
  } catch {
    return 0;
  }
}

export type EnvIssue = { path: string; message: string };

/**
 * Applies cross-field rules that plain per-field zod types can't express:
 * production-only strictness, mock-mode incompatibility with production, and
 * minimum cryptographic key strength regardless of environment.
 */
export function refineEnv(raw: RawEnv, issues: EnvIssue[] = []): EnvIssue[] {
  const addIssue = (path: string, message: string) => {
    issues.push({ path, message });
  };

  if (decodedByteLength(raw.MASTER_ENCRYPTION_KEY) !== 32) {
    addIssue(
      'MASTER_ENCRYPTION_KEY',
      'MASTER_ENCRYPTION_KEY must be a base64-encoded 32-byte key (e.g. `openssl rand -base64 32`)',
    );
  }

  if (decodedByteLength(raw.APP_SESSION_SIGNING_KEY) < 32) {
    addIssue(
      'APP_SESSION_SIGNING_KEY',
      'APP_SESSION_SIGNING_KEY must decode to at least 32 bytes (e.g. `openssl rand -base64 48`)',
    );
  }

  if (raw.NODE_ENV === 'production') {
    if (raw.MOCK_MODE) {
      addIssue('MOCK_MODE', 'MOCK_MODE must not be enabled when NODE_ENV=production');
    }
    if (!raw.APP_BASE_URL.startsWith('https://')) {
      addIssue('APP_BASE_URL', 'APP_BASE_URL must use https:// in production');
    }
    if (PLACEHOLDER_VALUES.has(raw.BIGCOMMERCE_CLIENT_ID.toLowerCase())) {
      addIssue('BIGCOMMERCE_CLIENT_ID', 'BIGCOMMERCE_CLIENT_ID is missing or a placeholder value');
    }
    if (PLACEHOLDER_VALUES.has(raw.BIGCOMMERCE_CLIENT_SECRET.toLowerCase())) {
      addIssue(
        'BIGCOMMERCE_CLIENT_SECRET',
        'BIGCOMMERCE_CLIENT_SECRET is missing or a placeholder value',
      );
    }
    if (!raw.DATABASE_URL.startsWith('postgres')) {
      addIssue('DATABASE_URL', 'DATABASE_URL must point at PostgreSQL in production');
    }
    if (raw.DATABASE_URL.startsWith('file:')) {
      addIssue(
        'DATABASE_URL',
        'SQLite (file: DATABASE_URL) is a local-dev-only path and must not be used in production',
      );
    }
  } else if (!raw.MOCK_MODE) {
    // Outside of mock mode, real BigCommerce credentials are still required
    // so the OAuth flow can be exercised locally against a draft app.
    if (PLACEHOLDER_VALUES.has(raw.BIGCOMMERCE_CLIENT_ID.toLowerCase())) {
      addIssue('BIGCOMMERCE_CLIENT_ID', 'BIGCOMMERCE_CLIENT_ID is required unless MOCK_MODE=true');
    }
    if (PLACEHOLDER_VALUES.has(raw.BIGCOMMERCE_CLIENT_SECRET.toLowerCase())) {
      addIssue(
        'BIGCOMMERCE_CLIENT_SECRET',
        'BIGCOMMERCE_CLIENT_SECRET is required unless MOCK_MODE=true',
      );
    }
  }

  return issues;
}
