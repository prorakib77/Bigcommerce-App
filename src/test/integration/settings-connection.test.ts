import { beforeEach, describe, expect, it } from 'vitest';
import { prisma } from '@/server/db/prisma';
import { resetDatabase } from '@/test/helpers/db-reset';
import { seedStore } from '@/test/factories/store-factory';
import { issueAppSession } from '@/server/session';
import { decryptSecret } from '@/server/crypto/encryption';

beforeEach(() => resetDatabase());

async function bearerFor(
  storeId: string,
  storeUserId: string,
  bigcommerceUserId: string,
  role: 'OWNER' | 'USER',
) {
  const session = await issueAppSession({ storeId, storeUserId, bigcommerceUserId, role });
  return `Bearer ${session.token}`;
}

describe('Kickflip connection settings', () => {
  it('lets the owner save new credentials, then masks the token on read', async () => {
    const { store, owner } = await seedStore();
    const auth = await bearerFor(store.id, owner.id, owner.bigcommerceUserId, 'OWNER');

    const { PUT } = await import('@/app/api/v1/kickflip/connection/route');
    const putResponse = await PUT(
      new Request('http://localhost:3000/api/v1/kickflip/connection', {
        method: 'PUT',
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId: 'new-tenant', apiToken: 'brand-new-token-value' }),
      }),
    );
    expect(putResponse.status).toBe(200);
    const putBody = (await putResponse.json()) as {
      data: { maskedToken: string; tenantId: string };
    };
    expect(putBody.data.tenantId).toBe('new-tenant');
    expect(putBody.data.maskedToken).toContain('value'.slice(-4));
    expect(putBody.data.maskedToken).not.toContain('brand-new-token-value');

    const connection = await prisma.kickflipConnection.findUniqueOrThrow({
      where: { storeId: store.id },
    });
    expect(decryptSecret(connection.encryptedApiToken!)).toBe('brand-new-token-value');
  });

  it('forbids a non-owner (USER role) from rotating credentials', async () => {
    const { store, owner } = await seedStore();
    await prisma.storeUser.create({
      data: {
        storeId: store.id,
        bigcommerceUserId: '2000',
        email: 'staff@example.com',
        role: 'USER',
        isActive: true,
      },
    });
    const staff = await prisma.storeUser.findUniqueOrThrow({
      where: { storeId_bigcommerceUserId: { storeId: store.id, bigcommerceUserId: '2000' } },
    });
    const auth = await bearerFor(store.id, staff.id, staff.bigcommerceUserId, 'USER');

    const { PUT } = await import('@/app/api/v1/kickflip/connection/route');
    const response = await PUT(
      new Request('http://localhost:3000/api/v1/kickflip/connection', {
        method: 'PUT',
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ tenantId: 'x', apiToken: 'y' }),
      }),
    );
    expect(response.status).toBe(403);

    // Original connection (from seedStore) must be untouched.
    const connection = await prisma.kickflipConnection.findUniqueOrThrow({
      where: { storeId: store.id },
    });
    expect(connection.tenantId).toBe('mock-tenant');

    void owner;
  });

  it('rejects requests with no session at all', async () => {
    const { GET } = await import('@/app/api/v1/kickflip/connection/route');
    const response = await GET(new Request('http://localhost:3000/api/v1/kickflip/connection'));
    expect(response.status).toBe(401);
  });

  it('disconnects without deleting import mappings', async () => {
    const { store, owner } = await seedStore();
    await prisma.importMapping.create({
      data: {
        storeId: store.id,
        kickflipDesignId: 'design-1',
        bigcommerceProductId: 1,
        sourceFingerprint: 'fp',
        status: 'ACTIVE',
      },
    });
    const auth = await bearerFor(store.id, owner.id, owner.bigcommerceUserId, 'OWNER');

    const { DELETE } = await import('@/app/api/v1/kickflip/connection/route');
    const response = await DELETE(
      new Request('http://localhost:3000/api/v1/kickflip/connection', {
        method: 'DELETE',
        headers: { Authorization: auth },
      }),
    );
    expect(response.status).toBe(200);

    const connection = await prisma.kickflipConnection.findUniqueOrThrow({
      where: { storeId: store.id },
    });
    expect(connection.status).toBe('DISCONNECTED');
    expect(connection.encryptedApiToken).toBeNull();

    const mapping = await prisma.importMapping.findFirstOrThrow({ where: { storeId: store.id } });
    expect(mapping.bigcommerceProductId).toBe(1);
  });
});

describe('Store settings', () => {
  it('lets the owner update import defaults', async () => {
    const { store, owner } = await seedStore();
    const auth = await bearerFor(store.id, owner.id, owner.bigcommerceUserId, 'OWNER');

    const { PUT } = await import('@/app/api/v1/settings/route');
    const response = await PUT(
      new Request('http://localhost:3000/api/v1/settings', {
        method: 'PUT',
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ skuPrefix: 'CUSTOM', defaultVisibility: true }),
      }),
    );
    expect(response.status).toBe(200);

    const settings = await prisma.storeSettings.findUniqueOrThrow({ where: { storeId: store.id } });
    expect(settings.skuPrefix).toBe('CUSTOM');
    expect(settings.defaultVisibility).toBe(true);
  });

  it('rejects an invalid sku prefix', async () => {
    const { store, owner } = await seedStore();
    const auth = await bearerFor(store.id, owner.id, owner.bigcommerceUserId, 'OWNER');

    const { PUT } = await import('@/app/api/v1/settings/route');
    const response = await PUT(
      new Request('http://localhost:3000/api/v1/settings', {
        method: 'PUT',
        headers: { Authorization: auth, 'Content-Type': 'application/json' },
        body: JSON.stringify({ skuPrefix: 'not valid!' }),
      }),
    );
    expect(response.status).toBe(400);
  });
});
