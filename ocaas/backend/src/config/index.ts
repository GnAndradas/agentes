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

// Parse comma-separated list of Telegram user IDs
function parseTelegramAllowedUserIds(value?: string): string[] {
  if (!value) return [];
  return value.split(',').map(id => id.trim()).filter(Boolean);
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
    // REST API token (for /v1/chat/completions, /v1/models)
    apiKey: env.OPENCLAW_API_KEY,
    // Webhook token (for /hooks/agent, /hooks/wake) - falls back to apiKey
    hooksToken: env.OPENCLAW_HOOKS_TOKEN || env.OPENCLAW_API_KEY,
    // Enable generation probe in diagnostics
    enableGenerationProbe: env.OPENCLAW_ENABLE_GENERATION_PROBE,
  },
  security: {
    apiSecretKey: env.API_SECRET_KEY,
  },
  logging: {
    level: env.LOG_LEVEL,
  },
  telegram: {
    botToken: env.TELEGRAM_BOT_TOKEN,
    chatId: env.TELEGRAM_CHAT_ID,
    allowedUserIds: parseTelegramAllowedUserIds(env.TELEGRAM_ALLOWED_USER_IDS),
    webhookSecret: env.TELEGRAM_WEBHOOK_SECRET,
  },
  autonomy: {
    level: env.AUTONOMY_LEVEL,
    humanTimeout: env.AUTONOMY_HUMAN_TIMEOUT,
    fallback: env.AUTONOMY_FALLBACK,
  },
} as const;

export type Config = typeof config;
