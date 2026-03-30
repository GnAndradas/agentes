import { config as loadDotenv } from 'dotenv';
import { homedir } from 'os';
import { loadEnv } from './env.js';

loadDotenv();

const env = loadEnv();

// Cross-platform home directory resolution
function resolveHomePath(path: string): string {
  if (path.startsWith('~')) {
    return path.replace('~', homedir());
  }
  return path;
}

export const config = {
  server: {
    port: env.PORT,
    host: env.HOST,
    isDev: env.NODE_ENV === 'development',
    isProd: env.NODE_ENV === 'production',
  },
  database: {
    url: env.DATABASE_URL,
  },
  openclaw: {
    gatewayUrl: env.OPENCLAW_GATEWAY_URL,
    workspacePath: resolveHomePath(env.OPENCLAW_WORKSPACE_PATH),
    apiKey: env.OPENCLAW_API_KEY,
  },
  security: {
    apiSecretKey: env.API_SECRET_KEY,
  },
  logging: {
    level: env.LOG_LEVEL,
  },
} as const;

export type Config = typeof config;
