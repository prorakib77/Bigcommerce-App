import { AppError } from '@/server/errors/app-error';
import type { ErrorCode } from '@/server/errors/codes';

export function mapBigCommerceHttpError(
  status: number,
  context?: Record<string, unknown>,
): AppError {
  const code: ErrorCode =
    status === 401 || status === 403
      ? 'BIGCOMMERCE_AUTH_FAILED'
      : status === 404
        ? 'BIGCOMMERCE_PRODUCT_NOT_FOUND'
        : status === 422 || status === 400
          ? 'BIGCOMMERCE_VALIDATION_FAILED'
          : status === 429
            ? 'BIGCOMMERCE_RATE_LIMITED'
            : status >= 500
              ? 'BIGCOMMERCE_API_UNAVAILABLE'
              : 'BIGCOMMERCE_API_UNAVAILABLE';

  return new AppError(code, { context: { upstreamStatus: status, ...context } });
}
