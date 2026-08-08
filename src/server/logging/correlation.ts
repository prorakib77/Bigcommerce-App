import { randomUUID } from 'node:crypto';

export function newCorrelationId(): string {
  return randomUUID();
}

/** Reuses an inbound `x-request-id` when it looks safe, otherwise mints a new one. */
export function resolveCorrelationId(inboundHeader: string | null | undefined): string {
  if (inboundHeader && /^[a-zA-Z0-9_-]{1,128}$/.test(inboundHeader)) {
    return inboundHeader;
  }
  return newCorrelationId();
}
