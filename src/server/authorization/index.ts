import type { StoreUserRole } from '@prisma/client';
import { AppError } from '@/server/errors/app-error';
import type { SessionContext } from '@/server/session';

/**
 * Centralized permission matrix. Every route/service that needs an
 * authorization decision should call one of these named checks rather than
 * comparing `session.role` inline, so the policy stays in one place as it
 * grows (e.g. a future `MANAGER` role).
 */
export const Permissions = {
  /** View dashboard, designs, import history, read-only settings/connection status. */
  VIEW: ['OWNER', 'USER'] as StoreUserRole[],
  /** Enqueue single/batch imports, retry, cancel. */
  MANAGE_IMPORTS: ['OWNER', 'USER'] as StoreUserRole[],
  /** Change Kickflip credentials, rotate/disconnect, and import default settings. */
  MANAGE_CONNECTION_AND_SETTINGS: ['OWNER'] as StoreUserRole[],
};

export function assertPermission(
  session: Pick<SessionContext, 'role'>,
  allowedRoles: StoreUserRole[],
): void {
  if (!allowedRoles.includes(session.role)) {
    throw new AppError('FORBIDDEN');
  }
}

export function isOwner(session: Pick<SessionContext, 'role'>): boolean {
  return session.role === 'OWNER';
}
