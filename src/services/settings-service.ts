import {
  getOrCreateStoreSettings,
  updateStoreSettings,
  type AppStoreSettings,
  type UpdateStoreSettingsInput,
} from '@/repositories/settings-repository';
import { recordAuditEvent } from '@/repositories/audit-repository';

export function getStoreSettings(storeId: string): Promise<AppStoreSettings> {
  return getOrCreateStoreSettings(storeId);
}

export async function updateStoreSettingsAndAudit(
  storeId: string,
  storeUserId: string,
  correlationId: string,
  input: UpdateStoreSettingsInput,
): Promise<AppStoreSettings> {
  const updated = await updateStoreSettings(storeId, input);
  await recordAuditEvent({
    storeId,
    storeUserId,
    action: 'settings.updated',
    entityType: 'store_settings',
    metadata: input,
    correlationId,
  });
  return updated;
}
