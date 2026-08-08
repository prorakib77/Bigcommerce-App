import { authedRoute, jsonOk } from '@/server/http/handler';
import { assertPermission, Permissions } from '@/server/authorization';
import { getStoreDashboardCounts } from '@/repositories/store-repository';
import { listAuditLogs } from '@/repositories/audit-repository';

export const dynamic = 'force-dynamic';

export const GET = authedRoute(async (_request, ctx) => {
  assertPermission(ctx.session, Permissions.VIEW);

  const [counts, recentActivity] = await Promise.all([
    getStoreDashboardCounts(ctx.session.storeId),
    listAuditLogs({ storeId: ctx.session.storeId, limit: 10 }),
  ]);

  return jsonOk(
    {
      ...counts,
      recentActivity: recentActivity.items.map((entry) => ({
        id: entry.id,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        createdAt: entry.createdAt.toISOString(),
      })),
    },
    ctx.requestId,
  );
});
