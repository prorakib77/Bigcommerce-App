import { getEnv } from '@/server/env';
import { getLogger } from '@/server/logging/logger';
import { AppError } from '@/server/errors/app-error';
import { newCorrelationId } from '@/server/logging/correlation';
import { bcTokenResponseSchema, type BcTokenResponse } from './schemas';

export interface ExchangeCodeInput {
  code: string;
  scope: string;
  context: string;
}

/**
 * Exchanges the OAuth authorization code from the auth callback for a
 * permanent store access token at BigCommerce's login service. Never logs
 * the code, client secret, or resulting access token.
 */
export async function exchangeAuthorizationCode(
  input: ExchangeCodeInput,
): Promise<BcTokenResponse> {
  const env = getEnv();
  const correlationId = newCorrelationId();
  const logger = getLogger().child({ correlationId, route: 'bigcommerce.oauth.exchange' });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), env.HTTP_REQUEST_TIMEOUT_MS);

  let response: Response;
  try {
    response = await fetch(`${env.BIGCOMMERCE_LOGIN_BASE_URL}/oauth2/token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        client_id: env.BIGCOMMERCE_CLIENT_ID,
        client_secret: env.BIGCOMMERCE_CLIENT_SECRET,
        redirect_uri: env.BIGCOMMERCE_AUTH_CALLBACK_URL,
        grant_type: 'authorization_code',
        code: input.code,
        scope: input.scope,
        context: input.context,
      }),
      signal: controller.signal,
    });
  } catch (error) {
    logger.error({ err: (error as Error).message }, 'BigCommerce token exchange request failed');
    throw new AppError('BIGCOMMERCE_API_UNAVAILABLE', { cause: error });
  } finally {
    clearTimeout(timeout);
  }

  if (!response.ok) {
    logger.warn(
      { upstreamStatus: response.status },
      'BigCommerce token exchange rejected the authorization code',
    );
    throw new AppError('BIGCOMMERCE_OAUTH_FAILED', {
      context: { upstreamStatus: response.status },
    });
  }

  const json: unknown = await response.json();
  const parsed = bcTokenResponseSchema.safeParse(json);
  if (!parsed.success) {
    logger.error(
      { issues: parsed.error.issues.map((i) => i.path.join('.')) },
      'BigCommerce token response failed schema validation',
    );
    throw new AppError('BIGCOMMERCE_OAUTH_FAILED', {
      publicDetail: 'Unexpected response from BigCommerce.',
    });
  }

  return parsed.data;
}

/** Returns true only if every scope this app requires is present in the granted scope string. */
export function requiredScopesGranted(grantedScope: string, requiredScopes: string[]): boolean {
  const granted = new Set(grantedScope.split(' ').filter(Boolean));
  return requiredScopes.every((scope) => granted.has(scope));
}
