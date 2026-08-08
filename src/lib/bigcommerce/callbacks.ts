import { jwtVerify } from 'jose';
import { getEnv } from '@/server/env';
import { AppError } from '@/server/errors/app-error';
import {
  bcCallbackJwtPayloadSchema,
  storeHashFromContext,
  type BcCallbackJwtPayload,
} from './schemas';

/**
 * BigCommerce's `signed_payload_jwt` always uses this literal string as its
 * `iss` claim — it is not the app's client ID. The client ID is instead the
 * `aud` (audience) claim. See
 * https://developer.bigcommerce.com/docs/integrations/apps/guide/handling-callbacks
 */
const BIGCOMMERCE_JWT_ISSUER = 'bc';

/**
 * Verifies a BigCommerce `signed_payload_jwt` (used by the load, uninstall,
 * and remove-user callbacks). Checks signature, algorithm, issuer (always
 * the literal `"bc"`), audience (must be this app's client ID), expiration,
 * and not-before, then validates the decoded payload shape. Never trust any
 * of this data before this passes.
 */
export async function verifyBigCommerceCallbackJwt(
  signedPayloadJwt: string,
): Promise<BcCallbackJwtPayload> {
  const env = getEnv();

  let payload: unknown;
  try {
    const result = await jwtVerify(
      signedPayloadJwt,
      new TextEncoder().encode(env.BIGCOMMERCE_CLIENT_SECRET),
      {
        algorithms: ['HS256'],
        issuer: BIGCOMMERCE_JWT_ISSUER,
        audience: env.BIGCOMMERCE_CLIENT_ID,
        clockTolerance: 5,
      },
    );
    payload = result.payload;
  } catch (error) {
    throw new AppError('BIGCOMMERCE_AUTH_FAILED', {
      publicDetail: 'The BigCommerce signed payload could not be verified.',
      cause: error,
    });
  }

  const parsed = bcCallbackJwtPayloadSchema.safeParse(payload);
  if (!parsed.success) {
    throw new AppError('BIGCOMMERCE_AUTH_FAILED', {
      publicDetail: 'The BigCommerce signed payload had an unexpected shape.',
      context: { issues: parsed.error.issues.map((i) => i.path.join('.')) },
    });
  }

  return parsed.data;
}

export function requireStoreHash(payload: BcCallbackJwtPayload): string {
  const hash = storeHashFromContext(payload.sub);
  if (!hash) {
    throw new AppError('BIGCOMMERCE_AUTH_FAILED', {
      publicDetail: 'The BigCommerce signed payload did not contain a valid store context.',
    });
  }
  return hash;
}
