import { AppError } from '@/server/errors/app-error';
import type { BigCommerceApiClient } from './client';
import {
  bcListResponseSchema,
  bcProductImageSchema,
  bcSingleResponseSchema,
  type BcProductImage,
} from './schemas';

const imageResponseSchema = bcSingleResponseSchema(bcProductImageSchema);
const imagesListResponseSchema = bcListResponseSchema(bcProductImageSchema);

export async function createProductImageFromUrl(
  client: BigCommerceApiClient,
  productId: number,
  imageUrl: string,
  isThumbnail: boolean,
): Promise<BcProductImage> {
  const result = await client.requestJson<unknown>(
    'POST',
    `/catalog/products/${productId}/images`,
    {
      body: { image_url: imageUrl, is_thumbnail: isThumbnail },
    },
  );
  const parsed = imageResponseSchema.safeParse(result.data);
  if (!parsed.success) {
    throw new AppError('IMAGE_UPLOAD_FAILED', {
      publicDetail: 'Unexpected response from BigCommerce.',
    });
  }
  return parsed.data.data;
}

export async function uploadProductImage(
  client: BigCommerceApiClient,
  productId: number,
  file: { buffer: Buffer; filename: string; contentType: string },
  isThumbnail: boolean,
): Promise<BcProductImage> {
  const formData = new FormData();
  formData.append('is_thumbnail', String(isThumbnail));
  formData.append(
    'image_file',
    new Blob([new Uint8Array(file.buffer)], { type: file.contentType }),
    file.filename,
  );

  const result = await client.requestMultipart<unknown>(
    'POST',
    `/catalog/products/${productId}/images`,
    formData,
  );
  const parsed = imageResponseSchema.safeParse(result.data);
  if (!parsed.success) {
    throw new AppError('IMAGE_UPLOAD_FAILED', {
      publicDetail: 'Unexpected response from BigCommerce.',
    });
  }
  return parsed.data.data;
}

export async function listProductImages(
  client: BigCommerceApiClient,
  productId: number,
): Promise<BcProductImage[]> {
  const result = await client.requestJson<unknown>('GET', `/catalog/products/${productId}/images`);
  const parsed = imagesListResponseSchema.safeParse(result.data);
  if (!parsed.success) {
    throw new AppError('BIGCOMMERCE_VALIDATION_FAILED', {
      publicDetail: 'Unexpected response while loading product images.',
    });
  }
  return parsed.data.data;
}
