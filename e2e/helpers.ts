import { SignJWT } from 'jose';
import { randomUUID } from 'node:crypto';
import type { Page } from '@playwright/test';

const CLIENT_ID = 'e2e_client_id';
const CLIENT_SECRET = 'e2e_client_secret';

export type E2eRole = 'owner' | 'staff';

const USERS: Record<E2eRole, { id: number; email: string }> = {
  owner: { id: 1000, email: 'owner@example.com' },
  staff: { id: 2000, email: 'staff@example.com' },
};

async function signLoadJwt(role: E2eRole): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  return new SignJWT({
    sub: 'stores/e2estore',
    context: 'stores/e2estore',
    user: USERS[role],
    owner: USERS.owner,
  })
    .setProtectedHeader({ alg: 'HS256' })
    .setIssuer('bc')
    .setAudience(CLIENT_ID)
    .setIssuedAt(now)
    .setExpirationTime(now + 300)
    .setJti(randomUUID())
    .sign(new TextEncoder().encode(CLIENT_SECRET));
}

/** Simulates BigCommerce loading the embedded app for the given user, landing on the dashboard. */
export async function loginAs(page: Page, role: E2eRole = 'owner'): Promise<void> {
  const token = await signLoadJwt(role);
  await page.goto(`/api/bigcommerce/load?signed_payload_jwt=${encodeURIComponent(token)}`);
  await page.waitForURL((url) => !url.searchParams.has('bootstrap'), { timeout: 15_000 });
}
