export interface ImportRunItem {
  id: string;
  kickflipDesignId: string;
  bigcommerceProductId: number | null;
  operation:
    'IMPORT_DESIGN' | 'UPDATE_DESIGN' | 'RETRY_IMAGES' | 'RECONCILE_MAPPING' | 'RECREATE_PRODUCT';
  status: string;
  currentStage: string | null;
  attemptCount: number;
  safeErrorCode: string | null;
  safeErrorMessage: string | null;
  correlationId: string;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
}
