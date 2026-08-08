import { describe, expect, it } from 'vitest';
import { httpStatusFor, safeMessageFor, ERROR_CODES } from './codes';
import { AppError, toAppError, isAppError } from './app-error';
import { mapKickflipHttpError } from '@/lib/kickflip/errors';
import { mapBigCommerceHttpError } from '@/lib/bigcommerce/errors';

describe('codes', () => {
  it('has a safe message and an HTTP status for every declared code', () => {
    for (const code of ERROR_CODES) {
      expect(safeMessageFor(code)).toBeTruthy();
      expect(httpStatusFor(code)).toBeGreaterThanOrEqual(200);
    }
  });
});

describe('AppError', () => {
  it('carries a stable code, safe message, and unique internal ref', () => {
    const error = new AppError('KICKFLIP_AUTH_FAILED');
    expect(error.code).toBe('KICKFLIP_AUTH_FAILED');
    expect(error.httpStatus).toBe(502);
    expect(error.internalRef).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('appends publicDetail to the base safe message without leaking internals', () => {
    const error = new AppError('VALIDATION_FAILED', { publicDetail: 'Name is required.' });
    expect(error.message).toContain('Name is required.');
  });

  it('serializes to a public JSON envelope containing only code/message/requestId', () => {
    const error = new AppError('FORBIDDEN', { context: { secret: 'do-not-leak' } });
    const json = error.toPublicJSON('req-1');
    expect(json).toEqual({
      error: { code: 'FORBIDDEN', message: expect.any(String), requestId: 'req-1' },
    });
    expect(JSON.stringify(json)).not.toContain('do-not-leak');
  });

  it('toAppError passes through an existing AppError unchanged', () => {
    const original = new AppError('NOT_FOUND');
    expect(toAppError(original)).toBe(original);
  });

  it('toAppError wraps an arbitrary thrown value as INTERNAL_ERROR', () => {
    const wrapped = toAppError(new Error('boom'));
    expect(wrapped.code).toBe('INTERNAL_ERROR');
    expect(isAppError(wrapped)).toBe(true);
  });
});

describe('mapKickflipHttpError', () => {
  it.each([
    [401, 'KICKFLIP_AUTH_FAILED'],
    [403, 'KICKFLIP_AUTH_FAILED'],
    [404, 'KICKFLIP_DESIGN_NOT_FOUND'],
    [429, 'KICKFLIP_RATE_LIMITED'],
    [500, 'KICKFLIP_API_UNAVAILABLE'],
    [503, 'KICKFLIP_API_UNAVAILABLE'],
  ])('maps HTTP %s to %s', (status, code) => {
    expect(mapKickflipHttpError(status).code).toBe(code);
  });
});

describe('mapBigCommerceHttpError', () => {
  it.each([
    [401, 'BIGCOMMERCE_AUTH_FAILED'],
    [404, 'BIGCOMMERCE_PRODUCT_NOT_FOUND'],
    [422, 'BIGCOMMERCE_VALIDATION_FAILED'],
    [429, 'BIGCOMMERCE_RATE_LIMITED'],
    [502, 'BIGCOMMERCE_API_UNAVAILABLE'],
  ])('maps HTTP %s to %s', (status, code) => {
    expect(mapBigCommerceHttpError(status).code).toBe(code);
  });

  it('never leaks the raw upstream error body in the public message', () => {
    const error = mapBigCommerceHttpError(422, { body: { secret_field: 'leak-me' } });
    expect(error.message).not.toContain('leak-me');
  });
});
