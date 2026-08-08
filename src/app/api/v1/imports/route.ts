import { z } from 'zod';
import { authedRoute, jsonOk } from '@/server/http/handler';
import { readJsonBody } from '@/server/http/body';
import { assertPermission, Permissions } from '@/server/authorization';
import { getEnv } from '@/server/env';
import { AppError } from '@/server/errors/app-error';
import { enqueueImports, getImportRunsPage } from '@/services/import-service';
import type { ImportStatus } from '@prisma/client';

export const dynamic = 'force-dynamic';

const IMPORT_STATUSES: ImportStatus[] = [
  'QUEUED',
  'FETCHING_SOURCE',
  'VALIDATING_SOURCE',
  'CREATING_PRODUCT',
  'UPDATING_PRODUCT',
  'PROCESSING_IMAGES',
  'WRITING_METADATA',
  'FINALIZING',
  'SUCCEEDED',
  'SKIPPED',
  'PARTIAL',
  'FAILED',
  'CANCELLED',
];

const postBodySchema = z.object({
  kickflipDesignIds: z.array(z.string().min(1)).min(1),
  recreate: z.boolean().optional().default(false),
});

export const POST = authedRoute(async (request, ctx) => {
  assertPermission(ctx.session, Permissions.MANAGE_IMPORTS);
  const env = getEnv();

  const parsed = postBodySchema.safeParse(await readJsonBody(request));
  if (!parsed.success) throw new AppError('VALIDATION_FAILED');
  if (parsed.data.kickflipDesignIds.length > env.MAX_BATCH_IMPORT_SIZE) {
    throw new AppError('VALIDATION_FAILED', {
      publicDetail: `A maximum of ${env.MAX_BATCH_IMPORT_SIZE} designs may be imported at once.`,
    });
  }

  const results = await enqueueImports(
    ctx.session.storeId,
    ctx.session.storeUserId,
    parsed.data.kickflipDesignIds,
    ctx.correlationId,
    parsed.data.recreate,
  );

  return jsonOk(results, ctx.requestId, { status: 202 });
});

const getQuerySchema = z.object({
  status: z.string().nullable(),
  kickflipDesignId: z.string().nullable(),
  bigcommerceProductId: z.string().nullable(),
  cursor: z.string().nullable(),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export const GET = authedRoute(async (request, ctx) => {
  assertPermission(ctx.session, Permissions.VIEW);

  const url = new URL(request.url);
  const parsed = getQuerySchema.safeParse({
    status: url.searchParams.get('status'),
    kickflipDesignId: url.searchParams.get('kickflipDesignId'),
    bigcommerceProductId: url.searchParams.get('bigcommerceProductId'),
    cursor: url.searchParams.get('cursor'),
    limit: url.searchParams.get('limit') ?? undefined,
  });
  if (!parsed.success) throw new AppError('VALIDATION_FAILED');

  const statusFilter = parsed.data.status
    ?.split(',')
    .filter((s): s is ImportStatus => IMPORT_STATUSES.includes(s as ImportStatus));

  const page = await getImportRunsPage({
    storeId: ctx.session.storeId,
    status: statusFilter,
    kickflipDesignId: parsed.data.kickflipDesignId ?? undefined,
    bigcommerceProductId: parsed.data.bigcommerceProductId
      ? Number(parsed.data.bigcommerceProductId)
      : undefined,
    cursor: parsed.data.cursor ?? undefined,
    limit: parsed.data.limit,
  });

  return jsonOk(page.items, ctx.requestId, { meta: { nextCursor: page.nextCursor } });
});
