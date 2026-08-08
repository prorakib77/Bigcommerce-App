export const dynamic = 'force-dynamic';

/** Liveness: only confirms the process is running and able to respond. No I/O, no secrets. */
export function GET(): Response {
  return new Response(JSON.stringify({ status: 'live' }), {
    status: 200,
    headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' },
  });
}
