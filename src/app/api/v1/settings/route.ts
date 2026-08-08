import { z } from 'zod';
import { authedRoute, jsonOk } from '@/server/http/handler';
import { readJsonBody } from '@/server/http/body';
import { assertPermission, Permissions } from '@/server/authorization';
import { AppError } from '@/server/errors/app-error';
import { getStoreSettings, updateStoreSettingsAndAudit } from '@/services/settings-service';

export const dynamic = 'force-dynamic';

export const GET = authedRoute(async (_request, ctx) => {
  assertPermission(ctx.session, Permissions.VIEW);
  const settings = await getStoreSettings(ctx.session.storeId);
  return jsonOk(
    {
      ...settings,
      defaultProductWeight: settings.defaultProductWeight.toString(),
    },
    ctx.requestId,
  );
});

const putBodySchema = z.object({
  defaultCategoryIds: z.array(z.number().int().positive()).max(50).optional(),
  defaultProductWeight: z.coerce.number().min(0).max(100_000).optional(),
  skuPrefix: z
    .string()
    .trim()
    .min(1)
    .max(20)
    .regex(/^[A-Za-z0-9-]+$/)
    .optional(),
  defaultVisibility: z.boolean().optional(),
  importImages: z.boolean().optional(),
  updateImagesOnReimport: z.boolean().optional(),
  updateNameOnReimport: z.boolean().optional(),
  updatePriceOnReimport: z.boolean().optional(),
  updateDescriptionOnReimport: z.boolean().optional(),
  maxImagesPerDesign: z.number().int().min(1).max(20).optional(),
});

export const PUT = authedRoute(async (request, ctx) => {
  assertPermission(ctx.session, Permissions.MANAGE_CONNECTION_AND_SETTINGS);

  const parsed = putBodySchema.safeParse(await readJsonBody(request));
  if (!parsed.success) throw new AppError('VALIDATION_FAILED');

  const updated = await updateStoreSettingsAndAudit(
    ctx.session.storeId,
    ctx.session.storeUserId,
    ctx.correlationId,
    parsed.data,
  );

  return jsonOk(
    { ...updated, defaultProductWeight: updated.defaultProductWeight.toString() },
    ctx.requestId,
  );
});
