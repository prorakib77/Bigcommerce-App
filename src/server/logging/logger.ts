import pino from 'pino';
import { getEnv } from '@/server/env';
import { PINO_REDACT_PATHS } from './redaction';

let rootLogger: pino.Logger | undefined;

function createLogger(): pino.Logger {
  const env = getEnv();
  const isProduction = env.NODE_ENV === 'production';

  return pino({
    level: env.LOG_LEVEL,
    base: { service: 'kickflip-import-app' },
    timestamp: pino.stdTimeFunctions.isoTime,
    redact: {
      paths: PINO_REDACT_PATHS,
      censor: '[REDACTED]',
    },
    transport: isProduction
      ? undefined
      : {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'HH:MM:ss', ignore: 'pid,hostname,service' },
        },
  });
}

/** Process-wide root logger. Prefer `logger.child({ correlationId })` per request/job. */
export function getLogger(): pino.Logger {
  if (!rootLogger) {
    rootLogger = createLogger();
  }
  return rootLogger;
}

export type AppLogger = pino.Logger;
