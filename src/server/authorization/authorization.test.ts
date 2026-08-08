import { describe, expect, it } from 'vitest';
import { assertPermission, isOwner, Permissions } from './index';
import { AppError } from '@/server/errors/app-error';

describe('assertPermission', () => {
  it('allows an OWNER to manage the connection and settings', () => {
    expect(() =>
      assertPermission({ role: 'OWNER' }, Permissions.MANAGE_CONNECTION_AND_SETTINGS),
    ).not.toThrow();
  });

  it('forbids a regular USER from managing the connection and settings', () => {
    expect(() =>
      assertPermission({ role: 'USER' }, Permissions.MANAGE_CONNECTION_AND_SETTINGS),
    ).toThrow(AppError);
  });

  it('allows a regular USER to manage imports', () => {
    expect(() => assertPermission({ role: 'USER' }, Permissions.MANAGE_IMPORTS)).not.toThrow();
  });

  it('throws a FORBIDDEN AppError, not a generic error', () => {
    try {
      assertPermission({ role: 'USER' }, Permissions.MANAGE_CONNECTION_AND_SETTINGS);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(AppError);
      expect((error as AppError).code).toBe('FORBIDDEN');
    }
  });
});

describe('isOwner', () => {
  it('returns true only for OWNER', () => {
    expect(isOwner({ role: 'OWNER' })).toBe(true);
    expect(isOwner({ role: 'USER' })).toBe(false);
  });
});
