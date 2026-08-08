import { getEnv } from '@/server/env';
import type { AppLogger } from '@/server/logging/logger';
import { redactUrl } from '@/server/logging/redaction';
import { toAppError } from '@/server/errors/app-error';
import type { BigCommerceCatalogService } from '@/lib/bigcommerce/catalog-service';
import type { BcProductImage } from '@/lib/bigcommerce/schemas';
import { downloadImageSecurely } from './download';
import { parseAndValidateImageUrl } from './allowlist';

export interface IngestImagesParams {
  catalogService: BigCommerceCatalogService;
  productId: number;
  imageUrls: string[];
  maxImages: number;
  correlationId: string;
  logger?: AppLogger;
  /** Images already on the product (e.g. from a prior partial attempt). When > 0, no new thumbnail is set. */
  existingImageCount?: number;
}

export interface IngestedImage {
  sourceUrl: string;
  bcImage: BcProductImage;
}

export interface FailedImage {
  sourceUrl: string;
  code: string;
  message: string;
}

export interface IngestImagesResult {
  uploaded: IngestedImage[];
  failed: FailedImage[];
}

/** A URL with query parameters is very likely time-limited/signed and should be downloaded, not linked. */
function looksStableForDirectLink(url: URL): boolean {
  return url.search === '' && url.toString().length < 512;
}

/**
 * Ingests up to `maxImages` design images for a product: stable, query-less
 * URLs on the trusted allowlist are linked directly (BigCommerce fetches
 * them itself); everything else — signed/expiring URLs in particular — is
 * downloaded through the SSRF-hardened pipeline and uploaded as multipart
 * form data. The first successful upload becomes the thumbnail. Per-image
 * failures are collected rather than thrown, so one bad image degrades the
 * import to "partial" instead of failing it outright.
 */
export async function ingestDesignImages(params: IngestImagesParams): Promise<IngestImagesResult> {
  const env = getEnv();
  const uploaded: IngestedImage[] = [];
  const failed: FailedImage[] = [];

  const candidates = params.imageUrls.slice(0, params.maxImages);
  const hasExistingThumbnail = (params.existingImageCount ?? 0) > 0;

  for (const sourceUrl of candidates) {
    const isThumbnail = !hasExistingThumbnail && uploaded.length === 0;
    try {
      const { url, allowed } = parseAndValidateImageUrl(
        sourceUrl,
        env.KICKFLIP_ALLOWED_IMAGE_HOSTS,
      );
      if (!allowed) {
        throw Object.assign(new Error('Image host not allowed'), {
          code: 'IMAGE_HOST_NOT_ALLOWED',
        });
      }

      if (looksStableForDirectLink(url)) {
        try {
          const bcImage = await params.catalogService.createProductImageFromUrl(
            params.productId,
            url.toString(),
            isThumbnail,
          );
          uploaded.push({ sourceUrl, bcImage });
          continue;
        } catch (directLinkError) {
          params.logger?.warn(
            {
              correlationId: params.correlationId,
              url: redactUrl(sourceUrl),
              err: (directLinkError as Error).message,
            },
            'Direct image_url upload failed, falling back to server-side download',
          );
          // fall through to the download+upload path below
        }
      }

      const downloaded = await downloadImageSecurely(sourceUrl, {
        maxBytes: env.IMAGE_MAX_BYTES,
        maxRedirects: env.IMAGE_MAX_REDIRECTS,
        connectTimeoutMs: env.HTTP_CONNECT_TIMEOUT_MS,
        requestTimeoutMs: env.HTTP_REQUEST_TIMEOUT_MS,
        allowedHosts: env.KICKFLIP_ALLOWED_IMAGE_HOSTS,
        correlationId: params.correlationId,
        logger: params.logger,
      });

      const bcImage = await params.catalogService.uploadProductImage(
        params.productId,
        {
          buffer: downloaded.buffer,
          filename: `design-image.${downloaded.contentType.split('/')[1]}`,
          contentType: downloaded.contentType,
        },
        isThumbnail,
      );
      uploaded.push({ sourceUrl, bcImage });
    } catch (error) {
      const appError = toAppError(error);
      params.logger?.warn(
        { correlationId: params.correlationId, url: redactUrl(sourceUrl), code: appError.code },
        'Image ingestion failed for one design image',
      );
      failed.push({
        sourceUrl: redactUrl(sourceUrl),
        code: appError.code,
        message: appError.message,
      });
    }
  }

  return { uploaded, failed };
}
