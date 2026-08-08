import type { Prisma, PrismaClient, StoreUser, StoreUserRole } from '@prisma/client';
import { prisma } from '@/server/db/prisma';

export interface UpsertStoreUserInput {
  storeId: string;
  bigcommerceUserId: string;
  email: string;
  role: StoreUserRole;
}

export async function upsertStoreUser(
  input: UpsertStoreUserInput,
  client: Prisma.TransactionClient | PrismaClient = prisma,
): Promise<StoreUser> {
  return client.storeUser.upsert({
    where: {
      storeId_bigcommerceUserId: {
        storeId: input.storeId,
        bigcommerceUserId: input.bigcommerceUserId,
      },
    },
    update: {
      email: input.email,
      // A previously-removed user re-appearing in a load callback is
      // re-activated, but their role is only ever escalated to OWNER by the
      // dedicated owner-install path — never silently by a load callback.
      isActive: true,
      removedAt: null,
    },
    create: {
      storeId: input.storeId,
      bigcommerceUserId: input.bigcommerceUserId,
      email: input.email,
      role: input.role,
      isActive: true,
    },
  });
}

export async function findStoreUser(
  storeId: string,
  bigcommerceUserId: string,
): Promise<StoreUser | null> {
  return prisma.storeUser.findUnique({
    where: { storeId_bigcommerceUserId: { storeId, bigcommerceUserId } },
  });
}

export async function findStoreUserById(storeUserId: string): Promise<StoreUser | null> {
  return prisma.storeUser.findUnique({ where: { id: storeUserId } });
}

export async function deactivateStoreUser(
  storeId: string,
  bigcommerceUserId: string,
): Promise<StoreUser | null> {
  const existing = await findStoreUser(storeId, bigcommerceUserId);
  if (!existing) return null;

  return prisma.storeUser.update({
    where: { id: existing.id },
    data: { isActive: false, removedAt: new Date() },
  });
}

export async function deactivateAllStoreUsers(storeId: string): Promise<void> {
  await prisma.storeUser.updateMany({
    where: { storeId, isActive: true },
    data: { isActive: false, removedAt: new Date() },
  });
}
