import type { Prisma } from '@prisma/client';
import { prisma } from '@/server/db/prisma';
import { getDbProvider } from '@/server/db/provider';

/**
 * The domain shape every caller of this repository sees, decoupled from the
 * raw generated Prisma type. Needed because `defaultCategoryIds` is a
 * native `Int[]` column on Postgres but a JSON-encoded `String` column on
 * the SQLite dev schema (SQLite has no array type — see
 * prisma/schema.sqlite.prisma). This file is the only place that knows
 * that; it always normalizes to `number[]` either way.
 */
export interface AppStoreSettings {
  storeId: string;
  defaultCategoryIds: number[];
  defaultProductWeight: Prisma.Decimal;
  skuPrefix: string;
  defaultVisibility: boolean;
  importImages: boolean;
  updateImagesOnReimport: boolean;
  updateNameOnReimport: boolean;
  updatePriceOnReimport: boolean;
  updateDescriptionOnReimport: boolean;
  maxImagesPerDesign: number;
  createdAt: Date;
  updatedAt: Date;
}

interface StoreSettingsRow {
  storeId: string;
  defaultCategoryIds: unknown;
  defaultProductWeight: Prisma.Decimal;
  skuPrefix: string;
  defaultVisibility: boolean;
  importImages: boolean;
  updateImagesOnReimport: boolean;
  updateNameOnReimport: boolean;
  updatePriceOnReimport: boolean;
  updateDescriptionOnReimport: boolean;
  maxImagesPerDesign: number;
  createdAt: Date;
  updatedAt: Date;
}

// `prisma.storeSettings` is statically typed against the Postgres shape
// (defaultCategoryIds: number[]) everywhere else in the app (see
// src/server/db/prisma.ts). This is the one file that also writes/reads
// that column in its SQLite-native shape (a JSON string), so it goes
// through a deliberately loosened local view of the model rather than
// fighting the static type on every call.
const storeSettingsModel = prisma.storeSettings as unknown as {
  upsert(args: {
    where: { storeId: string };
    update: Record<string, unknown>;
    create: Record<string, unknown>;
  }): Promise<StoreSettingsRow>;
};

const DEFAULTS = {
  defaultCategoryIds: [] as number[],
  defaultProductWeight: 0.5,
  skuPrefix: 'KF',
  defaultVisibility: false,
  importImages: true,
  updateImagesOnReimport: true,
  updateNameOnReimport: true,
  updatePriceOnReimport: true,
  updateDescriptionOnReimport: true,
  maxImagesPerDesign: 8,
};

export function encodeCategoryIds(ids: number[]): number[] | string {
  return getDbProvider() === 'sqlite' ? JSON.stringify(ids) : ids;
}

export function decodeCategoryIds(raw: unknown): number[] {
  if (Array.isArray(raw)) return raw as number[];
  if (typeof raw === 'string') {
    try {
      const parsed: unknown = JSON.parse(raw);
      return Array.isArray(parsed) ? (parsed as number[]) : [];
    } catch {
      return [];
    }
  }
  return [];
}

function toAppSettings(row: StoreSettingsRow): AppStoreSettings {
  return { ...row, defaultCategoryIds: decodeCategoryIds(row.defaultCategoryIds) };
}

export async function getOrCreateStoreSettings(storeId: string): Promise<AppStoreSettings> {
  const row = await storeSettingsModel.upsert({
    where: { storeId },
    update: {},
    create: {
      storeId,
      ...DEFAULTS,
      defaultCategoryIds: encodeCategoryIds(DEFAULTS.defaultCategoryIds),
    },
  });
  return toAppSettings(row);
}

export interface UpdateStoreSettingsInput {
  defaultCategoryIds?: number[];
  defaultProductWeight?: number;
  skuPrefix?: string;
  defaultVisibility?: boolean;
  importImages?: boolean;
  updateImagesOnReimport?: boolean;
  updateNameOnReimport?: boolean;
  updatePriceOnReimport?: boolean;
  updateDescriptionOnReimport?: boolean;
  maxImagesPerDesign?: number;
}

export async function updateStoreSettings(
  storeId: string,
  input: UpdateStoreSettingsInput,
): Promise<AppStoreSettings> {
  const { defaultCategoryIds, ...rest } = input;
  const patch: Record<string, unknown> = { ...rest };
  if (defaultCategoryIds !== undefined) {
    patch.defaultCategoryIds = encodeCategoryIds(defaultCategoryIds);
  }

  const row = await storeSettingsModel.upsert({
    where: { storeId },
    update: patch,
    create: {
      storeId,
      ...DEFAULTS,
      defaultCategoryIds: encodeCategoryIds(DEFAULTS.defaultCategoryIds),
      ...patch,
    },
  });
  return toAppSettings(row);
}
