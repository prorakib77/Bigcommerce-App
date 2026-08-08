import { authedRoute, jsonOk } from '@/server/http/handler';
import { assertPermission, Permissions } from '@/server/authorization';
import { manualSyncRecentOrders } from '@/services/order-service';

export const dynamic = 'force-dynamic';

/**
 * Manual "Sync now" — pulls recent orders directly from BigCommerce. Also
 * carries the Orders-webhook self-heal retry (see
 * src/services/order-service.ts::manualSyncRecentOrders) since this is a
 * rarer, explicit, already-cost-gated action (Permissions.MANAGE_IMPORTS,
 * same tier as POST /imports), unlike a GET that fires on every page view.
 */
export const POST = authedRoute(async (_request, ctx) => {
  assertPermission(ctx.session, Permissions.MANAGE_IMPORTS);
  const result = await manualSyncRecentOrders(ctx.session.storeId, ctx.correlationId, ctx.logger);
  return jsonOk(result, ctx.requestId);
});
