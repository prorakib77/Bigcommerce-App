import { AppError } from '@/server/errors/app-error';
import type { BigCommerceApiClient } from './client';
import { bcListResponseSchema, bcProductSchema, bcSingleResponseSchema, type BcProduct } from './schemas';

export interface CreateProductInput {
  name: string;
  /** Decimal string — converted to a number only at the network boundary, never used in arithmetic. */
  price: string;
  weight: number;
  sku: string;
  categories: number[];
  isVisible: boolean;
  description: string;
}

export interface UpdateProductInput {
  name?: string;
  price?: string;
  description?: string;
  isVisible?: boolean;
}

export interface ListProductsParams {
  page?: number;
  limit?: number;
  /** Matched server-side against product name/SKU. FLAG: BC's `keyword` query param is assumed, not confirmed live — see docs/api-assumptions.md. */
  search?: string;
}

export interface ProductsPage {
  items: BcProduct[];
  currentPage: number;
  totalPages: number;
}

const productResponseSchema = bcSingleResponseSchema(bcProductSchema);
const productsListResponseSchema = bcListResponseSchema(bcProductSchema);

function decimalStringToNumber(value: string): number {
  const num = Number(value);
  if (!Number.isFinite(num)) {
    throw new AppError('VALIDATION_FAILED', { publicDetail: 'Invalid price value.' });
  }
  return num;
}

export async function createProduct(
  client: BigCommerceApiClient,
  input: CreateProductInput,
): Promise<BcProduct> {
  const result = await client.requestJson<unknown>('POST', '/catalog/products', {
    body: {
      name: input.name,
      type: 'physical',
      price: decimalStringToNumber(input.price),
      weight: input.weight,
      sku: input.sku,
      categories: input.categories,
      is_visible: input.isVisible,
      inventory_tracking: 'none',
      description: input.description,
    },
  });

  const parsed = productResponseSchema.safeParse(result.data);
  if (!parsed.success) {
    throw new AppError('BIGCOMMERCE_VALIDATION_FAILED', {
      publicDetail: 'Unexpected response while creating the product.',
    });
  }
  return parsed.data.data;
}

export async function getProduct(
  client: BigCommerceApiClient,
  productId: number,
): Promise<BcProduct | null> {
  try {
    const result = await client.requestJson<unknown>('GET', `/catalog/products/${productId}`);
    const parsed = productResponseSchema.safeParse(result.data);
    if (!parsed.success) {
      throw new AppError('BIGCOMMERCE_VALIDATION_FAILED', {
        publicDetail: 'Unexpected response while loading the product.',
      });
    }
    return parsed.data.data;
  } catch (error) {
    if (error instanceof AppError && error.code === 'BIGCOMMERCE_PRODUCT_NOT_FOUND') {
      return null;
    }
    throw error;
  }
}

export async function updateProduct(
  client: BigCommerceApiClient,
  productId: number,
  input: UpdateProductInput,
): Promise<BcProduct> {
  const body: Record<string, unknown> = {};
  if (input.name !== undefined) body.name = input.name;
  if (input.price !== undefined) body.price = decimalStringToNumber(input.price);
  if (input.description !== undefined) body.description = input.description;
  if (input.isVisible !== undefined) body.is_visible = input.isVisible;

  const result = await client.requestJson<unknown>('PUT', `/catalog/products/${productId}`, {
    body,
  });
  const parsed = productResponseSchema.safeParse(result.data);
  if (!parsed.success) {
    throw new AppError('BIGCOMMERCE_VALIDATION_FAILED', {
      publicDetail: 'Unexpected response while updating the product.',
    });
  }
  return parsed.data.data;
}

/**
 * Lists every product in the store, page by page (mirrors listCategories's
 * pagination shape). Always requests `include=images` so list/edit UIs have
 * a thumbnail without a second per-product request.
 */
export async function listProducts(
  client: BigCommerceApiClient,
  params: ListProductsParams = {},
): Promise<ProductsPage> {
  const page = params.page ?? 1;
  const limit = params.limit ?? 20;

  const result = await client.requestJson<unknown>('GET', '/catalog/products', {
    query: {
      page,
      limit,
      include: 'images',
      ...(params.search ? { keyword: params.search } : {}),
    },
  });

  const parsed = productsListResponseSchema.safeParse(result.data);
  if (!parsed.success) {
    throw new AppError('BIGCOMMERCE_VALIDATION_FAILED', {
      publicDetail: 'Unexpected response while loading products.',
    });
  }

  return {
    items: parsed.data.data,
    currentPage: parsed.data.meta?.pagination?.current_page ?? page,
    totalPages: parsed.data.meta?.pagination?.total_pages ?? 1,
  };
}
