export interface DesignSummaryItem {
  label: string;
  value: string;
}

export interface DesignListItem {
  design: {
    externalId: string;
    name: string;
    price: string;
    currencyCode: string | null;
    updatedAt: string | null;
    primaryImageUrl: string | null;
    imageUrls: string[];
    summary: DesignSummaryItem[];
  };
  mapping: {
    status: 'NONE' | 'UP_TO_DATE' | 'CHANGED' | 'ORPHANED';
    bigcommerceProductId: number | null;
    lastSuccessfulImportAt: string | null;
  };
}
