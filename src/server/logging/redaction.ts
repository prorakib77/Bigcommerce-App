/**
 * Field-name patterns that must never appear unredacted in logs. Matched
 * case-insensitively against the final key segment of any log property path,
 * so `context.headers.authorization` and `Authorization` are both caught.
 */
const SENSITIVE_KEY_PATTERN =
  /^(authorization|cookie|set-cookie|x-auth-token|access[_-]?token|api[_-]?token|refresh[_-]?token|client[_-]?secret|password|secret|master[_-]?encryption[_-]?key|app[_-]?session[_-]?signing[_-]?key|signed[_-]?payload[_-]?jwt|jwt|encrypted[_-]?token)$/i;

export const PINO_REDACT_PATHS = [
  'req.headers.authorization',
  'req.headers.cookie',
  'req.headers["x-auth-token"]',
  '*.authorization',
  '*.access_token',
  '*.accessToken',
  '*.api_token',
  '*.apiToken',
  '*.client_secret',
  '*.clientSecret',
  '*.password',
  '*.encryptedToken',
  '*.encrypted_token',
  '*.signed_payload_jwt',
  '*.signedPayloadJwt',
];

export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERN.test(key);
}

/**
 * Deep-clones `value` while replacing any property whose key matches a
 * sensitive pattern with a fixed redaction marker. Used for one-off contexts
 * (e.g. error metadata) that don't flow through the logger's built-in
 * `redact` option.
 */
export function redactDeep<T>(value: T, seen = new WeakSet<object>()): T {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (seen.has(value as object)) {
    return value;
  }
  seen.add(value as object);

  if (Array.isArray(value)) {
    return value.map((item) => redactDeep(item, seen)) as unknown as T;
  }

  const result: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value as Record<string, unknown>)) {
    if (isSensitiveKey(key)) {
      result[key] = '[REDACTED]';
    } else if (val && typeof val === 'object') {
      result[key] = redactDeep(val, seen);
    } else {
      result[key] = val;
    }
  }
  return result as T;
}

/**
 * Strips query strings and userinfo from a URL before logging. Kickflip
 * image URLs are frequently signed with time-limited query parameters that
 * must never be persisted to logs.
 */
export function redactUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    url.search = '';
    url.username = '';
    url.password = '';
    return url.toString();
  } catch {
    return '[unparseable-url]';
  }
}
