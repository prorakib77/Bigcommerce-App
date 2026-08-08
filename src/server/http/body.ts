import { AppError } from '@/server/errors/app-error';

const DEFAULT_MAX_BODY_BYTES = 256 * 1024; // 256 KiB — generous for any JSON payload this app accepts

/**
 * Reads and JSON-parses a request body while enforcing a hard byte cap,
 * independent of (and in addition to) the `Content-Length` header, which a
 * client could omit or lie about.
 */
export async function readJsonBody(
  request: Request,
  maxBytes: number = DEFAULT_MAX_BODY_BYTES,
): Promise<unknown> {
  const declaredLength = request.headers.get('content-length');
  if (declaredLength && Number(declaredLength) > maxBytes) {
    throw new AppError('VALIDATION_FAILED', { publicDetail: 'Request body too large.' });
  }

  if (!request.body) {
    return undefined;
  }

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;

  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > maxBytes) {
      await reader.cancel();
      throw new AppError('VALIDATION_FAILED', { publicDetail: 'Request body too large.' });
    }
    chunks.push(value);
  }

  if (total === 0) return undefined;

  const buffer = Buffer.concat(chunks.map((c) => Buffer.from(c)));
  const text = buffer.toString('utf8');
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new AppError('VALIDATION_FAILED', {
      publicDetail: 'Request body was not valid JSON.',
      cause: error,
    });
  }
}
