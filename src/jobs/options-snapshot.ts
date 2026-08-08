import type { AppStoreSettings } from '@/repositories/settings-repository';

/** Frozen copy of the store's import defaults at the moment a job was enqueued, so a later
 * settings change never retroactively changes the behavior of an already-queued job. */
export interface ImportOptionsSnapshot {
  defaultCategoryIds: number[];
  defaultProductWeight: string;
  skuPrefix: string;
  defaultVisibility: boolean;
  importImages: boolean;
  updateImagesOnReimport: boolean;
  updateNameOnReimport: boolean;
  updatePriceOnReimport: boolean;
  updateDescriptionOnReimport: boolean;
  maxImagesPerDesign: number;
}

export function buildOptionsSnapshot(settings: AppStoreSettings): ImportOptionsSnapshot {
  return {
    defaultCategoryIds: settings.defaultCategoryIds,
    defaultProductWeight: settings.defaultProductWeight.toString(),
    skuPrefix: settings.skuPrefix,
    defaultVisibility: settings.defaultVisibility,
    importImages: settings.importImages,
    updateImagesOnReimport: settings.updateImagesOnReimport,
    updateNameOnReimport: settings.updateNameOnReimport,
    updatePriceOnReimport: settings.updatePriceOnReimport,
    updateDescriptionOnReimport: settings.updateDescriptionOnReimport,
    maxImagesPerDesign: settings.maxImagesPerDesign,
  };
}
