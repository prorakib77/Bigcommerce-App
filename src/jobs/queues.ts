export const QUEUES = {
  IMPORT_DESIGN: 'kickflip.import-design',
  UPDATE_DESIGN: 'kickflip.update-design',
  RETRY_IMAGES: 'kickflip.retry-images',
  RECONCILE_MAPPING: 'kickflip.reconcile-mapping',
} as const;

export type QueueName = (typeof QUEUES)[keyof typeof QUEUES];

/** Job payload is intentionally minimal: everything else is looked up (and
 * credentials decrypted) inside the worker from the ImportRun row itself,
 * so nothing sensitive ever sits in the durable job payload. */
export interface ImportJobPayload {
  importRunId: string;
}
