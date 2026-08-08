import { randomBytes } from 'node:crypto';
import { prisma } from '@/server/db/prisma';
import { sha256Hex } from '@/server/crypto/hash';
import { AppError } from '@/server/errors/app-error';

const BOOTSTRAP_PURPOSE = 'load-callback-bootstrap';
const BOOTSTRAP_TTL_SECONDS = 60;

export interface IssuedBootstrapCode {
  code: string;
  expiresAt: Date;
}

/**
 * Issues a single-use, short-lived code after a verified BigCommerce load
 * callback. The code — not the session token itself — travels through the
 * redirect back into the embedded app; the browser exchanges it for a real
 * bearer token via `POST /api/v1/session/bootstrap`. This keeps the actual
 * session token out of the URL/history entirely.
 */
export async function issueBootstrapCode(
  storeId: string,
  storeUserId: string,
): Promise<IssuedBootstrapCode> {
  const code = randomBytes(32).toString('base64url');
  const expiresAt = new Date(Date.now() + BOOTSTRAP_TTL_SECONDS * 1000);

  await prisma.oneTimeToken.create({
    data: {
      purpose: BOOTSTRAP_PURPOSE,
      tokenHash: sha256Hex(code),
      storeId,
      storeUserId,
      expiresAt,
    },
  });

  return { code, expiresAt };
}

export interface ConsumedBootstrapCode {
  storeId: string;
  storeUserId: string;
}

/**
 * Atomically consumes a bootstrap code: only the first caller to present a
 * given (unexpired, unused) code succeeds, preventing replay. Uses a
 * conditional update rather than read-then-write to close the race window.
 */
export async function consumeBootstrapCode(code: string): Promise<ConsumedBootstrapCode> {
  const tokenHash = sha256Hex(code);

  const result = await prisma.oneTimeToken.updateMany({
    where: {
      tokenHash,
      purpose: BOOTSTRAP_PURPOSE,
      usedAt: null,
      expiresAt: { gt: new Date() },
    },
    data: { usedAt: new Date() },
  });

  if (result.count === 0) {
    throw new AppError('UNAUTHENTICATED', {
      publicDetail: 'This bootstrap link has expired or was already used. Please reload the app.',
    });
  }

  const record = await prisma.oneTimeToken.findUniqueOrThrow({ where: { tokenHash } });
  return { storeId: record.storeId, storeUserId: record.storeUserId };
}

/** Deletes expired one-time tokens. Safe to run periodically as light housekeeping. */
export async function purgeExpiredOneTimeTokens(): Promise<number> {
  const result = await prisma.oneTimeToken.deleteMany({
    where: { expiresAt: { lt: new Date() } },
  });
  return result.count;
}
