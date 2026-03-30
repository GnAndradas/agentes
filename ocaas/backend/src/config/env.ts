import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().default(3001),
  HOST: z.string().default('0.0.0.0'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  DATABASE_URL: z.string().default('./data/ocaas.db'),

  OPENCLAW_GATEWAY_URL: z.string().url().default('http://localhost:18789'),
  OPENCLAW_WORKSPACE_PATH: z.string().default('~/.openclaw/workspace'),
  OPENCLAW_API_KEY: z.string().optional(),

  API_SECRET_KEY: z.string().min(16).default('dev-secret-key-min-16'),

  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

  // Telegram notifications (optional)
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional(),

  // Autonomy defaults
  AUTONOMY_LEVEL: z.enum(['manual', 'supervised', 'autonomous']).default('supervised'),
  AUTONOMY_HUMAN_TIMEOUT: z.coerce.number().default(300000), // 5 minutes
  AUTONOMY_FALLBACK: z.enum(['pause', 'reject', 'auto_approve']).default('pause'),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error('Invalid environment variables:', result.error.format());
    process.exit(1);
  }
  return result.data;
}
