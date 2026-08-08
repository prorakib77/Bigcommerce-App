import { randomUUID } from 'node:crypto';
import type { PrismaClient as SqlitePrismaClient, QueueJob } from '.prisma/client-sqlite';
import { prisma } from '@/server/db/prisma';
import { getEnv } from '@/server/env';
import { getLogger } from '@/server/logging/logger';
import { computeBackoffDelayMs } from '@/server/http/backoff';
import type { JobQueue, QueueJobHandle, SendOptions, WorkOptions } from './queue-types';

// The shared `prisma` singleton is statically typed as the Postgres client
// (see src/server/db/prisma.ts). This file only ever runs when
// getDbProvider() === 'sqlite' (selected in src/jobs/queue.ts), at which
// point the singleton genuinely *is* a SqlitePrismaClient instance — this
// cast is the one place that bridges the two generated types to reach the
// QueueJob model, which only exists in prisma/schema.sqlite.prisma.
const db = prisma as unknown as SqlitePrismaClient;

const LEASE_SECONDS = 600; // matches pg-boss's expireInSeconds in pgboss-queue.ts
const BASE_DELAY_MS = 5_000; // matches pg-boss's retryDelay: 5 (seconds)
const MAX_DELAY_MS = 300_000; // matches pg-boss's retryDelayMax: 300 (seconds)
const POLL_INTERVAL_MS = 750;

interface Registration {
  opts: WorkOptions;
  handler: (jobs: QueueJobHandle<object>[]) => Promise<void>;
}

interface Claimable {
  id: string;
  groupId: string;
}

/**
 * Picks which of `candidates` (already filtered to eligible/unblocked rows,
 * ordered oldest-first) to claim this tick, respecting both the overall
 * `freeSlots` cap and a per-`groupId` cap *within this same batch* — a plain
 * `take: freeSlots` wouldn't be enough, since several candidates could share
 * a group that's only allowed e.g. 2 concurrent jobs. Pure and DB-free so
 * it's directly unit-testable; the caller (claimAndRun) does the actual
 * claiming write.
 */
export function selectClaimable<T extends Claimable>(
  candidates: T[],
  freeSlots: number,
  groupLimit: number,
): T[] {
  const groupCountThisBatch = new Map<string, number>();
  const toClaim: T[] = [];
  for (const candidate of candidates) {
    if (toClaim.length >= freeSlots) break;
    const used = groupCountThisBatch.get(candidate.groupId) ?? 0;
    if (used >= groupLimit) continue;
    groupCountThisBatch.set(candidate.groupId, used + 1);
    toClaim.push(candidate);
  }
  return toClaim;
}

export type RetryOutcome =
  { action: 'retry'; retryCount: number; delayMs: number } | { action: 'fail'; retryCount: number };

/**
 * Decides whether a failed attempt should be retried (with backoff) or
 * marked permanently failed, given the queue row's current retry state.
 * Pure — the delay math is `computeBackoffDelayMs`
 * (src/server/http/backoff.ts), reused rather than reimplemented so the
 * SQLite and pg-boss queues back off the same way.
 */
export function decideRetryOutcome(
  priorRetryCount: number,
  retryLimit: number,
  baseDelayMs = BASE_DELAY_MS,
  maxDelayMs = MAX_DELAY_MS,
): RetryOutcome {
  const retryCount = priorRetryCount + 1;
  if (retryCount >= retryLimit) {
    return { action: 'fail', retryCount };
  }
  return {
    action: 'retry',
    retryCount,
    delayMs: computeBackoffDelayMs(retryCount, baseDelayMs, maxDelayMs),
  };
}

/**
 * Local-dev-only job queue backing the same `send`/`cancel`/`work` contract
 * as `PgBossQueue`, implemented with plain polling against a `QueueJob`
 * table instead of Postgres's `LISTEN/NOTIFY`/`SKIP LOCKED`. Good enough for
 * one web process + one worker process on one laptop; explicitly not a
 * production substitute for pg-boss — see
 * docs/architecture.md#sqlite-local-dev-path for exactly what guarantees
 * this does and doesn't provide.
 */
export class SqliteQueue implements JobQueue {
  private readonly registrations = new Map<string, Registration>();
  private readonly inFlight = new Set<AbortController>();
  private pollTimer: ReturnType<typeof setInterval> | undefined;
  private polling = false;
  private stopped = false;
  private readonly logger = getLogger().child({ queue: 'sqlite' });

  async send<T extends object>(
    queueName: string,
    data: T,
    opts: SendOptions,
  ): Promise<string | null> {
    const env = getEnv();
    const row = await db.queueJob.create({
      data: {
        id: randomUUID(),
        queueName,
        groupId: opts.group.id,
        data: JSON.stringify(data),
        retryLimit: env.IMPORT_MAX_ATTEMPTS,
      },
    });
    return row.id;
  }

  async cancel(queueName: string, jobId: string): Promise<void> {
    // Best-effort, matching the tolerance import-service.ts already applies
    // around pg-boss's own cancel(): only takes effect if not yet claimed.
    await db.queueJob.updateMany({
      where: { id: jobId, queueName, state: 'CREATED' },
      data: { state: 'CANCELLED' },
    });
  }

  async work<T extends object>(
    queueName: string,
    opts: WorkOptions,
    handler: (jobs: QueueJobHandle<T>[]) => Promise<void>,
  ): Promise<void> {
    this.registrations.set(queueName, {
      opts,
      handler: handler as (jobs: QueueJobHandle<object>[]) => Promise<void>,
    });
    this.ensurePolling();
  }

  async stop(): Promise<void> {
    this.stopped = true;
    if (this.pollTimer) clearInterval(this.pollTimer);
    for (const controller of this.inFlight) controller.abort();
    // Best-effort: give in-flight handlers a moment to observe the abort and
    // persist their own FAILED/CANCELLED transition before the process exits.
    const deadline = Date.now() + 5_000;
    while (this.inFlight.size > 0 && Date.now() < deadline) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  private ensurePolling(): void {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(() => void this.tick(), POLL_INTERVAL_MS);
  }

  private async tick(): Promise<void> {
    if (this.stopped || this.polling) return;
    this.polling = true;
    try {
      for (const [queueName, registration] of this.registrations) {
        await this.claimAndRun(queueName, registration);
      }
    } catch (error) {
      this.logger.error(
        { err: error instanceof Error ? error.message : String(error) },
        'sqlite-queue poll tick failed',
      );
    } finally {
      this.polling = false;
    }
  }

  private async claimAndRun(queueName: string, registration: Registration): Promise<void> {
    const { opts, handler } = registration;
    const now = new Date();

    const claimed = await db.$transaction(async (tx) => {
      // Crash recovery: a lease that expired without completing goes back to CREATED.
      await tx.queueJob.updateMany({
        where: { queueName, state: 'ACTIVE', expireAt: { lt: now } },
        data: { state: 'CREATED', expireAt: null },
      });

      const activeCount = await tx.queueJob.count({ where: { queueName, state: 'ACTIVE' } });
      const freeSlots = opts.localConcurrency - activeCount;
      if (freeSlots <= 0) return [];

      let blockedGroupIds: string[] = [];
      if (opts.groupConcurrency) {
        const activeByGroup = await tx.queueJob.groupBy({
          by: ['groupId'],
          where: { queueName, state: 'ACTIVE' },
          _count: { _all: true },
        });
        blockedGroupIds = activeByGroup
          .filter((g) => g._count._all >= opts.groupConcurrency!.default)
          .map((g) => g.groupId);
      }

      const candidates = await tx.queueJob.findMany({
        where: {
          queueName,
          state: 'CREATED',
          startAfter: { lte: now },
          ...(blockedGroupIds.length > 0 ? { groupId: { notIn: blockedGroupIds } } : {}),
        },
        orderBy: { createdAt: 'asc' },
        take: freeSlots * 4, // over-fetch; per-group cap within this batch is enforced below
      });

      const groupLimit = opts.groupConcurrency?.default ?? Infinity;
      const toClaim = selectClaimable(candidates, freeSlots, groupLimit);
      if (toClaim.length === 0) return [];

      const expireAt = new Date(now.getTime() + LEASE_SECONDS * 1000);
      await tx.queueJob.updateMany({
        where: { id: { in: toClaim.map((c) => c.id) } },
        data: { state: 'ACTIVE', expireAt },
      });
      return toClaim;
    });

    for (const row of claimed) {
      void this.runOne(row, handler);
    }
  }

  private async runOne(
    row: QueueJob,
    handler: (jobs: QueueJobHandle<object>[]) => Promise<void>,
  ): Promise<void> {
    const controller = new AbortController();
    this.inFlight.add(controller);
    const leaseTimer = setTimeout(() => controller.abort(), LEASE_SECONDS * 1000);

    try {
      const data = JSON.parse(row.data) as object;
      await handler([{ data, signal: controller.signal }]);
      await db.queueJob.update({ where: { id: row.id }, data: { state: 'COMPLETED' } });
    } catch (error) {
      const outcome = decideRetryOutcome(row.retryCount, row.retryLimit);
      if (outcome.action === 'fail') {
        await db.queueJob.update({
          where: { id: row.id },
          data: { state: 'FAILED', retryCount: outcome.retryCount },
        });
      } else {
        await db.queueJob
          .update({
            where: { id: row.id },
            data: {
              state: 'CREATED',
              retryCount: outcome.retryCount,
              startAfter: new Date(Date.now() + outcome.delayMs),
              expireAt: null,
            },
          })
          // The row may have been cancelled while active; losing the race is fine.
          .catch(() => undefined);
      }
      this.logger.warn(
        {
          queue: row.queueName,
          jobId: row.id,
          retryCount: outcome.retryCount,
          err: error instanceof Error ? error.message : String(error),
        },
        'sqlite-queue job attempt failed',
      );
    } finally {
      clearTimeout(leaseTimer);
      this.inFlight.delete(controller);
    }
  }
}

let instance: SqliteQueue | undefined;

export function getSqliteQueue(): SqliteQueue {
  instance ??= new SqliteQueue();
  return instance;
}

export async function stopSqliteQueue(): Promise<void> {
  if (instance) {
    await instance.stop();
    instance = undefined;
  }
}
