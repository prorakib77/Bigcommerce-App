export const ERROR_CODES = [
  // Auth / session
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'SESSION_EXPIRED',
  'STORE_INACTIVE',
  'VALIDATION_FAILED',
  'NOT_FOUND',
  'RATE_LIMITED',
  'CONFLICT',

  // BigCommerce OAuth / API
  'BIGCOMMERCE_OAUTH_FAILED',
  'BIGCOMMERCE_SCOPE_MISMATCH',
  'BIGCOMMERCE_AUTH_FAILED',
  'BIGCOMMERCE_RATE_LIMITED',
  'BIGCOMMERCE_VALIDATION_FAILED',
  'BIGCOMMERCE_PRODUCT_NOT_FOUND',
  'BIGCOMMERCE_API_UNAVAILABLE',

  // Kickflip
  'KICKFLIP_NOT_CONFIGURED',
  'KICKFLIP_AUTH_FAILED',
  'KICKFLIP_SCHEMA_MISMATCH',
  'KICKFLIP_RATE_LIMITED',
  'KICKFLIP_DESIGN_NOT_FOUND',
  'KICKFLIP_API_UNAVAILABLE',
  'KICKFLIP_CURRENCY_MISMATCH',

  // Images
  'IMAGE_HOST_NOT_ALLOWED',
  'IMAGE_TOO_LARGE',
  'IMAGE_TYPE_NOT_ALLOWED',
  'IMAGE_DOWNLOAD_FAILED',
  'IMAGE_UPLOAD_FAILED',

  // Imports
  'IMPORT_ALREADY_RUNNING',
  'IMPORT_ORPHANED_MAPPING',
  'IMPORT_PARTIAL',
  'IMPORT_FAILED',
  'IMPORT_CANCELLED',

  // Generic
  'INTERNAL_ERROR',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

const SAFE_MESSAGES: Record<ErrorCode, string> = {
  UNAUTHENTICATED: 'You must be signed in to perform this action.',
  FORBIDDEN: 'You do not have permission to perform this action.',
  SESSION_EXPIRED: 'Your session has expired. Please reload the app.',
  STORE_INACTIVE: 'This store is not currently active.',
  VALIDATION_FAILED: 'The request was invalid.',
  NOT_FOUND: 'The requested resource was not found.',
  RATE_LIMITED: 'Too many requests. Please try again shortly.',
  CONFLICT: 'The request conflicts with the current state of the resource.',

  BIGCOMMERCE_OAUTH_FAILED: 'BigCommerce authorization could not be completed.',
  BIGCOMMERCE_SCOPE_MISMATCH: 'The BigCommerce app scopes do not match what was requested.',
  BIGCOMMERCE_AUTH_FAILED: 'The BigCommerce connection could not be authenticated.',
  BIGCOMMERCE_RATE_LIMITED: 'BigCommerce is rate-limiting this store. Please try again shortly.',
  BIGCOMMERCE_VALIDATION_FAILED: 'BigCommerce rejected the request as invalid.',
  BIGCOMMERCE_PRODUCT_NOT_FOUND: 'The BigCommerce product could not be found.',
  BIGCOMMERCE_API_UNAVAILABLE: 'BigCommerce is temporarily unavailable.',

  KICKFLIP_NOT_CONFIGURED: 'Kickflip is not connected for this store.',
  KICKFLIP_AUTH_FAILED: 'The Kickflip connection could not be authenticated.',
  KICKFLIP_SCHEMA_MISMATCH: 'Kickflip returned data in an unexpected format.',
  KICKFLIP_RATE_LIMITED: 'Kickflip is rate-limiting this store. Please try again shortly.',
  KICKFLIP_DESIGN_NOT_FOUND: 'The requested Kickflip design could not be found.',
  KICKFLIP_API_UNAVAILABLE: 'Kickflip is temporarily unavailable.',
  KICKFLIP_CURRENCY_MISMATCH:
    'The design currency does not match this store’s currency. Import blocked.',

  IMAGE_HOST_NOT_ALLOWED: 'The image host is not on the trusted allowlist.',
  IMAGE_TOO_LARGE: 'The image exceeds the maximum allowed size.',
  IMAGE_TYPE_NOT_ALLOWED: 'The image type is not supported.',
  IMAGE_DOWNLOAD_FAILED: 'The image could not be downloaded.',
  IMAGE_UPLOAD_FAILED: 'The image could not be uploaded to BigCommerce.',

  IMPORT_ALREADY_RUNNING: 'An import for this design is already running.',
  IMPORT_ORPHANED_MAPPING: 'The previously imported BigCommerce product no longer exists.',
  IMPORT_PARTIAL: 'The import completed with some steps unresolved.',
  IMPORT_FAILED: 'The import failed.',
  IMPORT_CANCELLED: 'The import was cancelled.',

  INTERNAL_ERROR: 'Something went wrong. Please try again.',
};

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  SESSION_EXPIRED: 401,
  STORE_INACTIVE: 403,
  VALIDATION_FAILED: 400,
  NOT_FOUND: 404,
  RATE_LIMITED: 429,
  CONFLICT: 409,

  BIGCOMMERCE_OAUTH_FAILED: 502,
  BIGCOMMERCE_SCOPE_MISMATCH: 502,
  BIGCOMMERCE_AUTH_FAILED: 502,
  BIGCOMMERCE_RATE_LIMITED: 429,
  BIGCOMMERCE_VALIDATION_FAILED: 422,
  BIGCOMMERCE_PRODUCT_NOT_FOUND: 404,
  BIGCOMMERCE_API_UNAVAILABLE: 502,

  KICKFLIP_NOT_CONFIGURED: 409,
  KICKFLIP_AUTH_FAILED: 502,
  KICKFLIP_SCHEMA_MISMATCH: 502,
  KICKFLIP_RATE_LIMITED: 429,
  KICKFLIP_DESIGN_NOT_FOUND: 404,
  KICKFLIP_API_UNAVAILABLE: 502,
  KICKFLIP_CURRENCY_MISMATCH: 422,

  IMAGE_HOST_NOT_ALLOWED: 422,
  IMAGE_TOO_LARGE: 422,
  IMAGE_TYPE_NOT_ALLOWED: 422,
  IMAGE_DOWNLOAD_FAILED: 502,
  IMAGE_UPLOAD_FAILED: 502,

  IMPORT_ALREADY_RUNNING: 409,
  IMPORT_ORPHANED_MAPPING: 409,
  IMPORT_PARTIAL: 200,
  IMPORT_FAILED: 500,
  IMPORT_CANCELLED: 200,

  INTERNAL_ERROR: 500,
};

export function safeMessageFor(code: ErrorCode): string {
  return SAFE_MESSAGES[code];
}

export function httpStatusFor(code: ErrorCode): number {
  return STATUS_BY_CODE[code];
}
