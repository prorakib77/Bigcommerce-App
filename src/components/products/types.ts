export interface ProductImageSummary {
  id: number;
  image_url?: string;
  is_thumbnail?: boolean;
}

export interface BcProductSummary {
  id: number;
  name: string;
  sku?: string;
  price?: number | string;
  description?: string;
  is_visible?: boolean;
  categories?: number[];
  images?: ProductImageSummary[];
}

export interface ProductListItem {
  product: BcProductSummary;
  hasCustomizeConfig: boolean;
}

export interface ProductMappingSummary {
  kickflipDesignId: string;
  kickflipCustomizerProductId: string | null;
}

export interface ProductCustomizeSummary {
  enabled: boolean;
  customizeUrl: string | null;
  buttonLabel: string;
}

export interface ProductDetail {
  product: BcProductSummary;
  mapping: ProductMappingSummary | null;
  customizeConfig: ProductCustomizeSummary | null;
  suggestedCustomizeUrl: string | null;
}
