import { AppError } from '@/server/errors/app-error';
import type { BigCommerceApiClient } from './client';
import { bcCategorySchema, bcListResponseSchema, type BcCategory } from './schemas';

export interface CategoriesPage {
  items: BcCategory[];
  currentPage: number;
  totalPages: number;
}

const categoriesListResponseSchema = bcListResponseSchema(bcCategorySchema);

/** Lists BigCommerce tree categories, one page at a time (BC caps page size at 250). */
export async function listCategories(
  client: BigCommerceApiClient,
  page = 1,
  limit = 250,
): Promise<CategoriesPage> {
  const result = await client.requestJson<unknown>('GET', '/catalog/categories', {
    query: { page, limit },
  });

  const parsed = categoriesListResponseSchema.safeParse(result.data);
  if (!parsed.success) {
    throw new AppError('BIGCOMMERCE_VALIDATION_FAILED', {
      publicDetail: 'Unexpected response while loading categories.',
    });
  }

  return {
    items: parsed.data.data,
    currentPage: parsed.data.meta?.pagination?.current_page ?? page,
    totalPages: parsed.data.meta?.pagination?.total_pages ?? 1,
  };
}
