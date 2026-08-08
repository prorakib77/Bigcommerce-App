/**
 * Best-effort client IP extraction behind a reverse proxy (Render sits in
 * front of the app). Only the first hop of `x-forwarded-for` is trusted,
 * matching Render's documented single-proxy setup.
 */
export function getClientIp(request: Request): string {
  const forwardedFor = request.headers.get('x-forwarded-for');
  if (forwardedFor) {
    const first = forwardedFor.split(',')[0]?.trim();
    if (first) return first;
  }
  const realIp = request.headers.get('x-real-ip');
  if (realIp) return realIp;
  return 'unknown';
}
