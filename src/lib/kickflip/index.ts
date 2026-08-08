import { getEnv } from '@/server/env';
import type { AppLogger } from '@/server/logging/logger';
import { KickflipClient, type KickflipClientOptions, type ListDesignsResult } from './client';
import { MockKickflipClient } from './mock-client';
import type {
  KickflipCredentials,
  ListDesignsParams,
  NormalizedKickflipDesign,
  TestConnectionResult,
} from './types';

export interface IKickflipClient {
  testConnection(correlationId: string, signal?: AbortSignal): Promise<TestConnectionResult>;
  listDesigns(params: ListDesignsParams): Promise<ListDesignsResult>;
  getDesign(
    designId: string,
    correlationId: string,
    signal?: AbortSignal,
  ): Promise<NormalizedKickflipDesign>;
}

export function createKickflipClient(
  credentials: KickflipCredentials,
  options: KickflipClientOptions & { logger?: AppLogger } = {},
): IKickflipClient {
  if (getEnv().MOCK_MODE) {
    return new MockKickflipClient(credentials);
  }
  return new KickflipClient(credentials, options);
}

export * from './types';
export * from './mapper';
export * from './errors';
export { MOCK_TENANTS } from './mock-client';
