import { AppError } from '@/server/errors/app-error';
import type { ErrorCode } from '@/server/errors/codes';

export function mapKickflipHttpError(status: number, context?: Record<string, unknown>): AppError {
  const code: ErrorCode =
    status === 401 || status === 403
      ? 'KICKFLIP_AUTH_FAILED'
      : status === 404
        ? 'KICKFLIP_DESIGN_NOT_FOUND'
        : status === 429
          ? 'KICKFLIP_RATE_LIMITED'
          : status >= 500
            ? 'KICKFLIP_API_UNAVAILABLE'
            : 'KICKFLIP_API_UNAVAILABLE';

  return new AppError(code, { context: { upstreamStatus: status, ...context } });
}
