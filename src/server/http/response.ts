import { AppError, toAppError } from '@/server/errors/app-error';

export interface ApiEnvelope<T> {
  data: T;
  meta: { requestId: string } & Record<string, unknown>;
}

export function jsonOk<T>(
  data: T,
  requestId: string,
  init: { status?: number; meta?: Record<string, unknown> } = {},
): Response {
  const body: ApiEnvelope<T> = { data, meta: { requestId, ...init.meta } };
  return new Response(JSON.stringify(body), {
    status: init.status ?? 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export function jsonError(error: unknown, requestId: string): Response {
  const appError = toAppError(error);
  const body = appError.toPublicJSON(requestId);
  return new Response(JSON.stringify(body), {
    status: appError.httpStatus,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}

export { AppError };
