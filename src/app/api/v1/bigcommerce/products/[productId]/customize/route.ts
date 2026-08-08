import { z } from 'zod';
import { authedRoute, jsonOk } from '@/server/http/handler';
import { readJsonBody } from '@/server/http/body';
import { assertPermission, Permissions } from '@/server/authorization';
import { AppError } from '@/server/errors/app-error';
import { saveProductCustomizeConfig } from '@/services/product-customize-service';

export const dynamic = 'force-dynamic';

const putBodySchema = z
  .object({
    enabled: z.boolean(),
    customizeUrl: z.url({ protocol: /^https$/ }).max(2048).nullable(),
    buttonLabel: z.string().trim().min(1).max(60).optional().default('Customize'),
  })
  .refine((body) => !body.enabled || body.customizeUrl !== null, {
    message: 'customizeUrl is required when enabled is true',
    path: ['customizeUrl'],
  });

export const PUT = authedRoute(async (request, ctx) => {
  assertPermission(ctx.session, Permissions.MANAGE_IMPORTS);

  const productId = Number(ctx.params.productId);
  if (!ctx.params.productId || !Number.isInteger(productId) || productId <= 0) {
    throw new AppError('VALIDATION_FAILED');
  }

  const parsed = putBodySchema.safeParse(await readJsonBody(request));
  if (!parsed.success) throw new AppError('VALIDATION_FAILED');

  const config = await saveProductCustomizeConfig({
    storeId: ctx.session.storeId,
    storeUserId: ctx.session.storeUserId,
    bigcommerceProductId: productId,
    enabled: parsed.data.enabled,
    customizeUrl: parsed.data.customizeUrl,
    buttonLabel: parsed.data.buttonLabel,
    correlationId: ctx.correlationId,
    logger: ctx.logger,
  });

  return jsonOk(config, ctx.requestId);
});
