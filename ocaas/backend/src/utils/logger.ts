import pino from 'pino';
import { config } from '../config/index.js';

export const logger = pino({
  level: config.logging.level,
  transport: config.server.isDev
    ? {
        target: 'pino-pretty',
        options: {
          colorize: true,
          translateTime: 'SYS:standard',
          ignore: 'pid,hostname',
        },
      }
    : undefined,
  base: { service: 'ocaas' },
});

export function createLogger(context: string) {
  return logger.child({ context });
}

export type Logger = typeof logger;
