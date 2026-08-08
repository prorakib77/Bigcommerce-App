import { prisma } from '@/server/db/prisma';
import { getEnv } from '@/server/env';

export const dynamic = 'force-dynamic';

/**
 * Readiness: verifies the database is reachable and configuration is
 * valid. Deliberately does NOT call Kickflip or BigCommerce — those are
 * per-store, third-party dependencies and not appropriate for a
 * process-level readiness probe.
 */
export async function GET(): Promise<Response> {
  try {
    getEnv();
    await prisma.$queryRaw`SELECT 1`;
    return new Response(JSON.stringify({ status: 'ready' }), {
      status: 200,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  } catch {
    return new Response(JSON.stringify({ status: 'not_ready' }), {
      status: 503,
      headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
    });
  }
}
