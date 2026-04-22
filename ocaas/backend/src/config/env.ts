import { z } from 'zod';

const envSchema = z.object({
  PORT: z.coerce.number().default(3001),
  HOST: z.string().default('0.0.0.0'),
  NODE_ENV: z.enum(['development', 'production', 'test']).default('development'),

  DATABASE_URL: z.string().default('./data/ocaas.db'),

  // OpenClaw REST API (synchronous - for AI generation)
  OPENCLAW_GATEWAY_URL: z.string().url().default('http://localhost:18789'),
  OPENCLAW_WORKSPACE_PATH: z.string().default('~/.openclaw/workspace'),
  // Token for REST API (/v1/chat/completions, /v1/models) - used in chat_completion fallback mode
  OPENCLAW_API_KEY: z.string().optional(),
  // Token for Webhooks (/hooks/agent, /hooks/wake) - SEPARATE from API_KEY, no fallback
  // PROMPT 13: Tokens are independent, not interchangeable
  OPENCLAW_HOOKS_TOKEN: z.string().optional(),
  // Enable generation probe during diagnostics (tests actual AI generation)
  OPENCLAW_ENABLE_GENERATION_PROBE: z.coerce.boolean().default(false),
  // WebSocket URL (optional - defaults to ws:// version of GATEWAY_URL)
  // Set explicitly if WS endpoint differs from REST
  OPENCLAW_WS_URL: z.string().optional(),
  // WebSocket mode: 'required' | 'optional' | 'disabled'
  // - required: fail if WS cannot connect
  // - optional: degrade gracefully if WS fails (default)
  // - disabled: never attempt WS connection
  OPENCLAW_WS_MODE: z.enum(['required', 'optional', 'disabled']).default('optional'),
  // PROMPT 21: Optional backend model override (sent via x-openclaw-model header)
  // Format: provider/model (e.g., openai/gpt-4o-mini, anthropic/claude-3-sonnet)
  // If not set, OpenClaw uses its internal default
  OPENCLAW_BACKEND_MODEL: z.string().optional(),

  API_SECRET_KEY: z.string().min(16).default('dev-secret-key-min-16'),

  LOG_LEVEL: z.enum(['trace', 'debug', 'info', 'warn', 'error', 'fatal']).default('info'),

  // Telegram notifications (optional)
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_CHAT_ID: z.string().optional(),
  // Comma-separated list of allowed Telegram user IDs for approval actions
  TELEGRAM_ALLOWED_USER_IDS: z.string().optional(),
  // Secret for webhook validation
  TELEGRAM_WEBHOOK_SECRET: z.string().optional(),

  // Autonomy defaults
  AUTONOMY_LEVEL: z.enum(['manual', 'supervised', 'autonomous']).default('supervised'),
  AUTONOMY_HUMAN_TIMEOUT: z.coerce.number().default(300000), // 5 minutes
  AUTONOMY_FALLBACK: z.enum(['pause', 'reject', 'auto_approve']).default('pause'),

  // Execution timeouts
  JOB_EXECUTION_TIMEOUT_MS: z.coerce.number().default(60000), // 60 seconds default

  // Task Dispatch Configuration
  // DEFAULT_OPENCLAW_AGENT_ID: Agent ID to use when no specific agent is assigned
  // If set, tasks without agent assignment will use this agent
  DEFAULT_OPENCLAW_AGENT_ID: z.string().optional(),
  // TASK_DISPATCH_MODE: How tasks are dispatched to OpenClaw
  // - 'auto': Automatically dispatch tasks to agents based on matching
  // - 'default_agent': Always use DEFAULT_OPENCLAW_AGENT_ID (fallback to first active)
  // - 'manual': Require explicit agent assignment before dispatch
  TASK_DISPATCH_MODE: z.enum(['auto', 'default_agent', 'manual']).default('auto'),
});

export type Env = z.infer<typeof envSchema>;

export function loadEnv(): Env {
  const result = envSchema.safeParse(process.env);
  if (!result.success) {
    console.error('Invalid environment variables:', result.error.format());
    process.exit(1);
  }

  const env = result.data;

  // SECURITY: Warn about insecure defaults in production
  if (env.NODE_ENV === 'production') {
    if (env.API_SECRET_KEY === 'dev-secret-key-min-16') {
      console.error('SECURITY WARNING: API_SECRET_KEY is using default value. Set a secure random value for production.');
    }
  }

  return env;
}
