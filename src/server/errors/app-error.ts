import { randomUUID } from 'node:crypto';
import { type ErrorCode, httpStatusFor, safeMessageFor } from './codes';

export interface AppErrorOptions {
  /** Safe-for-client detail appended to the generic code message, if any. */
  publicDetail?: string;
  /** Original error, kept server-side only for logging. */
  cause?: unknown;
  /** Extra structured context for server logs. Never sent to the client. */
  context?: Record<string, unknown>;
}

/**
 * The one exception type application/service/route code should throw for
 * any expected failure. Carries a stable public `code`, a safe public
 * `message`, and an `internalRef` correlating the response the client sees
 * with the detailed server-side log entry.
 */
export class AppError extends Error {
  readonly code: ErrorCode;
  readonly httpStatus: number;
  readonly internalRef: string;
  readonly context?: Record<string, unknown>;
  override readonly cause?: unknown;

  constructor(code: ErrorCode, options: AppErrorOptions = {}) {
    const message = options.publicDetail
      ? `${safeMessageFor(code)} ${options.publicDetail}`
      : safeMessageFor(code);
    super(message);
    this.name = 'AppError';
    this.code = code;
    this.httpStatus = httpStatusFor(code);
    this.internalRef = randomUUID();
    this.context = options.context;
    this.cause = options.cause;
  }

  toPublicJSON(requestId: string) {
    return {
      error: {
        code: this.code,
        message: this.message,
        requestId,
      },
    };
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}

/** Normalizes any thrown value into an AppError, defaulting to INTERNAL_ERROR. */
export function toAppError(error: unknown): AppError {
  if (isAppError(error)) {
    return error;
  }
  return new AppError('INTERNAL_ERROR', { cause: error });
}
