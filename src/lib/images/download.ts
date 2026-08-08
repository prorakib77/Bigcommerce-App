import dns from 'node:dns';
import { Agent } from 'undici';
import type { AppLogger } from '@/server/logging/logger';
import { redactUrl } from '@/server/logging/redaction';
import { AppError } from '@/server/errors/app-error';
import { isBlockedIpAddress } from './ssrf';
import { parseAndValidateImageUrl } from './allowlist';
import {
  detectImageTypeFromBytes,
  isSupportedDeclaredType,
  type SupportedImageType,
} from './content-type';

const REDIRECT_STATUS_CODES = new Set([301, 302, 303, 307, 308]);

/** RequestInit plus Node/undici's non-standard `dispatcher` option (not part of lib.dom's types). */
interface NodeFetchInit extends RequestInit {
  dispatcher?: Agent;
}

/**
 * DNS lookup used for every connection this module makes. Resolves the
 * hostname itself (rather than trusting a separate, earlier check) so the
 * safety check is synchronized with the actual TCP connection — closing
 * the DNS-rebinding TOCTOU gap a "check then fetch()" approach would leave
 * open.
 */
function safeLookup(
  hostname: string,
  options: dns.LookupAllOptions | dns.LookupOptions,
  callback: (err: NodeJS.ErrnoException | null, address: unknown, family?: number) => void,
): void {
  dns.lookup(hostname, { all: true }, (err, addresses) => {
    if (err) {
      callback(err, null);
      return;
    }
    const safeAddresses = addresses.filter((a) => !isBlockedIpAddress(a.address));
    if (safeAddresses.length === 0) {
      callback(new Error(`SSRF_BLOCKED: ${hostname} resolved only to disallowed addresses`), null);
      return;
    }
    if ('all' in options && options.all) {
      callback(null, safeAddresses);
      return;
    }
    callback(null, safeAddresses[0]!.address, safeAddresses[0]!.family);
  });
}

function createSafeAgent(connectTimeoutMs: number): Agent {
  return new Agent({
    connect: { lookup: safeLookup as never, timeout: connectTimeoutMs },
  });
}

export interface DownloadedImage {
  buffer: Buffer;
  contentType: SupportedImageType;
  byteLength: number;
}

export interface DownloadImageOptions {
  maxBytes: number;
  maxRedirects: number;
  connectTimeoutMs: number;
  requestTimeoutMs: number;
  allowedHosts: string[];
  correlationId: string;
  logger?: AppLogger;
}

/**
 * Securely downloads an image: HTTPS + allowlisted host only, DNS-resolved
 * and IP-range-checked at the moment of connection, redirects re-validated
 * hop by hop up to a configured limit, streamed with a hard byte cap
 * instead of buffered unbounded, and the resulting bytes sniffed for a
 * real, supported image signature rather than trusting headers or the URL.
 */
export async function downloadImageSecurely(
  initialUrl: string,
  options: DownloadImageOptions,
): Promise<DownloadedImage> {
  const agent = createSafeAgent(options.connectTimeoutMs);
  let currentUrl = initialUrl;

  try {
    for (let hop = 0; hop <= options.maxRedirects; hop += 1) {
      const { url, allowed } = parseAndValidateImageUrl(currentUrl, options.allowedHosts);
      if (!allowed) {
        throw new AppError('IMAGE_HOST_NOT_ALLOWED', {
          context: { host: url.hostname },
        });
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), options.requestTimeoutMs);

      let response: Response;
      try {
        // `dispatcher` is a non-standard Node/undici fetch() extension not
        // present in lib.dom's RequestInit — see NodeFetchInit below.
        const init: NodeFetchInit = {
          redirect: 'manual',
          signal: controller.signal,
          dispatcher: agent,
        };
        response = await fetch(url, init as RequestInit);
      } catch (error) {
        options.logger?.warn(
          {
            correlationId: options.correlationId,
            url: redactUrl(currentUrl),
            err: (error as Error).message,
          },
          'Image download failed',
        );
        throw new AppError('IMAGE_DOWNLOAD_FAILED', { cause: error });
      } finally {
        clearTimeout(timer);
      }

      if (REDIRECT_STATUS_CODES.has(response.status)) {
        if (hop === options.maxRedirects) {
          throw new AppError('IMAGE_DOWNLOAD_FAILED', { publicDetail: 'Too many redirects.' });
        }
        const location = response.headers.get('location');
        if (!location) {
          throw new AppError('IMAGE_DOWNLOAD_FAILED', {
            publicDetail: 'Redirect without a location.',
          });
        }
        currentUrl = new URL(location, url).toString();
        continue;
      }

      if (!response.ok) {
        throw new AppError('IMAGE_DOWNLOAD_FAILED', { context: { status: response.status } });
      }

      const declaredType = response.headers.get('content-type');
      if (declaredType && !isSupportedDeclaredType(declaredType)) {
        throw new AppError('IMAGE_TYPE_NOT_ALLOWED', { context: { declaredType } });
      }

      const declaredLength = response.headers.get('content-length');
      if (declaredLength && Number(declaredLength) > options.maxBytes) {
        throw new AppError('IMAGE_TOO_LARGE', { context: { declaredLength } });
      }

      const buffer = await readBodyWithCap(response, options.maxBytes);
      const detectedType = detectImageTypeFromBytes(buffer);
      if (!detectedType) {
        throw new AppError('IMAGE_TYPE_NOT_ALLOWED', {
          publicDetail: 'The downloaded file was not a recognized image format.',
        });
      }

      return { buffer, contentType: detectedType, byteLength: buffer.byteLength };
    }

    throw new AppError('IMAGE_DOWNLOAD_FAILED', { publicDetail: 'Too many redirects.' });
  } finally {
    await agent.close().catch(() => undefined);
  }
}

async function readBodyWithCap(response: Response, maxBytes: number): Promise<Buffer> {
  if (!response.body) {
    throw new AppError('IMAGE_DOWNLOAD_FAILED', { publicDetail: 'Empty response body.' });
  }

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new AppError('IMAGE_TOO_LARGE');
    }
    chunks.push(value);
  }

  return Buffer.concat(chunks.map((c) => Buffer.from(c)));
}
