import { envSchema, refineEnv, type RawEnv } from './schema';

export class EnvValidationError extends Error {
  constructor(public readonly issues: Array<{ path: string; message: string }>) {
    super(
      `Invalid environment configuration:\n${issues
        .map((issue) => `  - ${issue.path}: ${issue.message}`)
        .join('\n')}`,
    );
    this.name = 'EnvValidationError';
  }
}

function loadEnv(source: NodeJS.ProcessEnv): RawEnv {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => ({
      path: issue.path.join('.'),
      message: issue.message,
    }));
    throw new EnvValidationError(issues);
  }

  const refinementIssues = refineEnv(parsed.data);
  if (refinementIssues.length > 0) {
    throw new EnvValidationError(refinementIssues);
  }

  return parsed.data;
}

let cached: RawEnv | undefined;

/**
 * Validated, memoized environment configuration. Throws `EnvValidationError`
 * on first access if configuration is missing, malformed, or unsafe for the
 * current NODE_ENV. Both the web and worker entry points import this before
 * doing anything else so misconfiguration fails fast at boot.
 */
export function getEnv(): RawEnv {
  if (!cached) {
    cached = loadEnv(process.env);
  }
  return cached;
}

/** Test-only escape hatch to force re-validation against a fresh env object. */
export function __resetEnvCacheForTests(): void {
  if (process.env.NODE_ENV !== 'test') {
    throw new Error('__resetEnvCacheForTests may only be used under NODE_ENV=test');
  }
  cached = undefined;
}

export const env = new Proxy({} as RawEnv, {
  get(_target, prop: string | symbol) {
    return getEnv()[prop as keyof RawEnv];
  },
});
