import { getEnv } from '@/server/env';
import type { AppLogger } from '@/server/logging/logger';
import { AppError } from '@/server/errors/app-error';
import { BigCommerceApiClient } from './client';
import { listCategories, type CategoriesPage } from './categories';
import {
  createProduct,
  getProduct,
  updateProduct,
  listProducts as listProductsAdapter,
  type CreateProductInput,
  type UpdateProductInput,
  type ListProductsParams,
  type ProductsPage,
} from './catalog';
import { createProductImageFromUrl, uploadProductImage, listProductImages } from './images';
import { writeImportMetafields, type ImportMetafieldValues } from './metafields';
import { getStoreCurrencyCode } from './store-info';
import type { BcProduct, BcProductImage } from './schemas';

export interface UploadImageFile {
  buffer: Buffer;
  filename: string;
  contentType: string;
}

/**
 * Everything the import engine needs from BigCommerce's catalog, behind one
 * seam so job handlers can be unit-tested against `MockBigCommerceCatalogService`
 * without a network dependency, and so the real implementation can evolve
 * independently.
 */
export interface BigCommerceCatalogService {
  listCategories(page?: number): Promise<CategoriesPage>;
  listProducts(params?: ListProductsParams): Promise<ProductsPage>;
  createProduct(input: CreateProductInput): Promise<BcProduct>;
  getProduct(productId: number): Promise<BcProduct | null>;
  updateProduct(productId: number, input: UpdateProductInput): Promise<BcProduct>;
  createProductImageFromUrl(
    productId: number,
    url: string,
    isThumbnail: boolean,
  ): Promise<BcProductImage>;
  uploadProductImage(
    productId: number,
    file: UploadImageFile,
    isThumbnail: boolean,
  ): Promise<BcProductImage>;
  listProductImages(productId: number): Promise<BcProductImage[]>;
  writeImportMetafields(productId: number, values: ImportMetafieldValues): Promise<void>;
  getStoreCurrencyCode(): Promise<string>;
}

export interface BigCommerceCatalogServiceOptions {
  storeHash: string;
  accessToken: string;
  correlationId: string;
  logger?: AppLogger;
}

class RealCatalogService implements BigCommerceCatalogService {
  private readonly client: BigCommerceApiClient;

  constructor(options: BigCommerceCatalogServiceOptions) {
    this.client = new BigCommerceApiClient(options);
  }

  listCategories(page = 1): Promise<CategoriesPage> {
    return listCategories(this.client, page);
  }
  listProducts(params?: ListProductsParams): Promise<ProductsPage> {
    return listProductsAdapter(this.client, params);
  }
  createProduct(input: CreateProductInput): Promise<BcProduct> {
    return createProduct(this.client, input);
  }
  getProduct(productId: number): Promise<BcProduct | null> {
    return getProduct(this.client, productId);
  }
  updateProduct(productId: number, input: UpdateProductInput): Promise<BcProduct> {
    return updateProduct(this.client, productId, input);
  }
  createProductImageFromUrl(
    productId: number,
    url: string,
    isThumbnail: boolean,
  ): Promise<BcProductImage> {
    return createProductImageFromUrl(this.client, productId, url, isThumbnail);
  }
  uploadProductImage(
    productId: number,
    file: UploadImageFile,
    isThumbnail: boolean,
  ): Promise<BcProductImage> {
    return uploadProductImage(this.client, productId, file, isThumbnail);
  }
  listProductImages(productId: number): Promise<BcProductImage[]> {
    return listProductImages(this.client, productId);
  }
  writeImportMetafields(productId: number, values: ImportMetafieldValues): Promise<void> {
    return writeImportMetafields(this.client, productId, values);
  }
  getStoreCurrencyCode(): Promise<string> {
    return getStoreCurrencyCode(this.client);
  }
}

let mockIdSequence = 900_000;
const mockPartialFailureAttempted = new Set<number>();

// Fixture product/image id ranges are kept disjoint from mockIdSequence
// (900_000+, used for products created via the import flow) so the two
// never collide.
const FIXTURE_PRODUCT_ID_START = 100_001;
const FIXTURE_IMAGE_ID_START = 150_001;

/** A tiny inline placeholder thumbnail — data: URIs are covered by the app's CSP img-src, unlike an external image host. */
function buildPlaceholderImageDataUri(label: string): string {
  const initial = label.trim().charAt(0).toUpperCase() || '?';
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="200" height="200"><rect width="200" height="200" fill="#E9EEFF"/><text x="50%" y="50%" font-family="sans-serif" font-size="72" fill="#8C93AD" text-anchor="middle" dominant-baseline="central">${initial}</text></svg>`;
  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

interface FixtureProductSpec {
  name: string;
  sku: string;
  price: string;
  isVisible: boolean;
  categories: number[];
}

const FIXTURE_PRODUCTS: FixtureProductSpec[] = [
  { name: 'Classic Crew Tee', sku: 'DEMO-0001', price: '24.99', isVisible: true, categories: [2] },
  { name: 'Vintage Wash Hoodie', sku: 'DEMO-0002', price: '54.99', isVisible: true, categories: [3] },
  { name: 'Everyday Joggers', sku: 'DEMO-0003', price: '39.99', isVisible: true, categories: [1] },
  { name: 'Graphic Print Tee', sku: 'DEMO-0004', price: '27.99', isVisible: true, categories: [2] },
  { name: 'Zip-Up Fleece Jacket', sku: 'DEMO-0005', price: '64.99', isVisible: true, categories: [3] },
  { name: 'Cropped Tank Top', sku: 'DEMO-0006', price: '19.99', isVisible: false, categories: [2] },
  { name: 'Relaxed Fit Sweatshirt', sku: 'DEMO-0007', price: '44.99', isVisible: true, categories: [3] },
  { name: 'Performance Polo', sku: 'DEMO-0008', price: '34.99', isVisible: true, categories: [1] },
  { name: 'Long Sleeve Henley', sku: 'DEMO-0009', price: '29.99', isVisible: true, categories: [2] },
  { name: 'Quilted Vest', sku: 'DEMO-0010', price: '59.99', isVisible: false, categories: [3] },
  { name: 'Snapback Cap', sku: 'DEMO-0011', price: '22.99', isVisible: true, categories: [1] },
  { name: 'Canvas Tote Bag', sku: 'DEMO-0012', price: '18.99', isVisible: true, categories: [1] },
];

/**
 * In-memory BigCommerce simulator for development/CI without real
 * BigCommerce credentials. Products/images/metafields live only for the
 * process lifetime. A product whose SKU contains `PARTIALSIM` fails its
 * first metafield write (then succeeds on retry) to exercise the partial
 * import / resume-on-retry path end-to-end.
 *
 * Seeded with a dozen fixture products at construction (distinct id range
 * from products created via the import flow) so the Products page and its
 * integration tests have deterministic, non-empty data to browse/assert
 * against in mock mode.
 */
class MockCatalogService implements BigCommerceCatalogService {
  private readonly products = new Map<number, BcProduct>();
  private readonly images = new Map<number, BcProductImage[]>();

  constructor() {
    FIXTURE_PRODUCTS.forEach((spec, index) => {
      const id = FIXTURE_PRODUCT_ID_START + index;
      const imageId = FIXTURE_IMAGE_ID_START + index;
      this.products.set(id, {
        id,
        name: spec.name,
        sku: spec.sku,
        price: spec.price,
        description: `<p>${spec.name} — demo fixture product for local development.</p>`,
        is_visible: spec.isVisible,
        categories: spec.categories,
      });
      this.images.set(id, [
        {
          id: imageId,
          product_id: id,
          is_thumbnail: true,
          sort_order: 0,
          // A data: URI, not an external host — the app's own CSP (img-src)
          // only allows 'self', data:, and the real Kickflip CDN hosts, so
          // an external placeholder-image service would be silently blocked
          // by the browser (confirmed: this was a real bug here before,
          // caught by an actual browser console check, not just review).
          image_url: buildPlaceholderImageDataUri(spec.name),
        },
      ]);
    });
  }

  async listCategories(): Promise<CategoriesPage> {
    return {
      items: [
        { id: 1, parent_id: 0, name: 'Shop All', is_visible: true },
        { id: 2, parent_id: 1, name: 'T-Shirts', is_visible: true },
        { id: 3, parent_id: 1, name: 'Hoodies', is_visible: true },
      ],
      currentPage: 1,
      totalPages: 1,
    };
  }

  async createProduct(input: CreateProductInput): Promise<BcProduct> {
    const id = mockIdSequence++;
    const product: BcProduct = {
      id,
      name: input.name,
      sku: input.sku,
      price: input.price,
      is_visible: input.isVisible,
      categories: input.categories,
    };
    this.products.set(id, product);
    this.images.set(id, []);
    return product;
  }

  async getProduct(productId: number): Promise<BcProduct | null> {
    return this.products.get(productId) ?? null;
  }

  async updateProduct(productId: number, input: UpdateProductInput): Promise<BcProduct> {
    const existing = this.products.get(productId);
    if (!existing) throw new AppError('BIGCOMMERCE_PRODUCT_NOT_FOUND');
    const updated = {
      ...existing,
      ...(input.name !== undefined ? { name: input.name } : {}),
      ...(input.price !== undefined ? { price: input.price } : {}),
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.isVisible !== undefined ? { is_visible: input.isVisible } : {}),
    };
    this.products.set(productId, updated);
    return updated;
  }

  async listProducts(params: ListProductsParams = {}): Promise<ProductsPage> {
    const page = params.page ?? 1;
    const limit = params.limit ?? 20;
    const search = params.search?.trim().toLowerCase();

    const all = Array.from(this.products.values()).filter((product) => {
      if (!search) return true;
      return (
        product.name.toLowerCase().includes(search) ||
        (product.sku ?? '').toLowerCase().includes(search)
      );
    });

    const totalPages = Math.max(1, Math.ceil(all.length / limit));
    const start = (page - 1) * limit;
    const items = all.slice(start, start + limit).map((product) => ({
      ...product,
      images: this.images.get(product.id) ?? [],
    }));

    return { items, currentPage: page, totalPages };
  }

  async createProductImageFromUrl(
    productId: number,
    url: string,
    isThumbnail: boolean,
  ): Promise<BcProductImage> {
    return this.pushMockImage(productId, isThumbnail);
  }

  async uploadProductImage(
    productId: number,
    _file: UploadImageFile,
    isThumbnail: boolean,
  ): Promise<BcProductImage> {
    return this.pushMockImage(productId, isThumbnail);
  }

  private pushMockImage(productId: number, isThumbnail: boolean): BcProductImage {
    const list = this.images.get(productId) ?? [];
    const image: BcProductImage = {
      id: mockIdSequence++,
      product_id: productId,
      is_thumbnail: isThumbnail,
      sort_order: list.length,
    };
    list.push(image);
    this.images.set(productId, list);
    return image;
  }

  async listProductImages(productId: number): Promise<BcProductImage[]> {
    return this.images.get(productId) ?? [];
  }

  async writeImportMetafields(productId: number, _values: ImportMetafieldValues): Promise<void> {
    const product = this.products.get(productId);
    if (product?.sku?.includes('PARTIALSIM') && !mockPartialFailureAttempted.has(productId)) {
      mockPartialFailureAttempted.add(productId);
      throw new AppError('BIGCOMMERCE_API_UNAVAILABLE', {
        publicDetail: '(simulated) transient failure writing metadata',
      });
    }
  }

  async getStoreCurrencyCode(): Promise<string> {
    return 'USD';
  }
}

const sharedMockCatalogService = new MockCatalogService();

export function createCatalogService(
  options: BigCommerceCatalogServiceOptions,
): BigCommerceCatalogService {
  if (getEnv().MOCK_MODE) {
    return sharedMockCatalogService;
  }
  return new RealCatalogService(options);
}
