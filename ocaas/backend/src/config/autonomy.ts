import { nanoid } from 'nanoid';
import { eq } from 'drizzle-orm';
import { db, schema } from '../db/index.js';
import { createLogger } from '../utils/logger.js';
import { nowTimestamp } from '../utils/helpers.js';

const logger = createLogger('autonomy');

// Types
export type AutonomyLevel = 'manual' | 'supervised' | 'autonomous';
export type FallbackBehavior = 'pause' | 'reject' | 'auto_approve';
export type TaskApprovalPolicy = 'none' | 'high_priority' | 'all';

export interface ApprovalPolicy {
  taskExecution: TaskApprovalPolicy;
  agentCreation: boolean;
  skillGeneration: boolean;
  toolGeneration: boolean;
}

export interface AutonomyConfig {
  level: AutonomyLevel;
  canCreateAgents: boolean;
  canGenerateSkills: boolean;
  canGenerateTools: boolean;
  requireApprovalFor: ApprovalPolicy;
  humanTimeout: number; // ms, default 300000 (5 min)
  fallbackBehavior: FallbackBehavior;
  sequentialExecution: boolean;
}

// Parse env vars with validation
function getEnvAutonomyLevel(): AutonomyLevel {
  const val = process.env.AUTONOMY_LEVEL;
  if (val === 'manual' || val === 'supervised' || val === 'autonomous') {
    return val;
  }
  return 'supervised';
}

function getEnvFallbackBehavior(): FallbackBehavior {
  const val = process.env.AUTONOMY_FALLBACK;
  if (val === 'pause' || val === 'reject' || val === 'auto_approve') {
    return val;
  }
  return 'pause';
}

function getEnvHumanTimeout(): number {
  const val = parseInt(process.env.AUTONOMY_HUMAN_TIMEOUT || '', 10);
  return isNaN(val) || val <= 0 ? 300000 : val;
}

// Defaults (uses env vars if set)
export const DEFAULT_AUTONOMY_CONFIG: AutonomyConfig = {
  level: getEnvAutonomyLevel(),
  canCreateAgents: true,
  canGenerateSkills: true,
  canGenerateTools: true,
  requireApprovalFor: {
    taskExecution: 'high_priority',
    agentCreation: true,
    skillGeneration: true,
    toolGeneration: true,
  },
  humanTimeout: getEnvHumanTimeout(),
  fallbackBehavior: getEnvFallbackBehavior(),
  sequentialExecution: true,
};

const AUTONOMY_CONFIG_KEY = 'autonomy';

// In-memory cache
let cachedConfig: AutonomyConfig | null = null;

export async function loadAutonomyConfig(): Promise<AutonomyConfig> {
  if (cachedConfig) {
    return cachedConfig;
  }

  try {
    const rows = await db
      .select()
      .from(schema.systemConfig)
      .where(eq(schema.systemConfig.key, AUTONOMY_CONFIG_KEY))
      .limit(1);

    if (rows.length > 0 && rows[0]?.value) {
      cachedConfig = JSON.parse(rows[0].value) as AutonomyConfig;
      return cachedConfig;
    }
  } catch (err) {
    logger.warn({ err }, 'Failed to load autonomy config from DB, using defaults');
  }

  // Return defaults if not found
  cachedConfig = { ...DEFAULT_AUTONOMY_CONFIG };
  return cachedConfig;
}

type PartialAutonomyConfigInput = Omit<Partial<AutonomyConfig>, 'requireApprovalFor'> & {
  requireApprovalFor?: Partial<ApprovalPolicy>;
};

export async function saveAutonomyConfig(config: PartialAutonomyConfigInput): Promise<AutonomyConfig> {
  const current = await loadAutonomyConfig();
  const updated: AutonomyConfig = {
    ...current,
    ...config,
    requireApprovalFor: {
      ...current.requireApprovalFor,
      ...(config.requireApprovalFor ?? {}),
    },
  };

  const now = nowTimestamp();
  const value = JSON.stringify(updated);

  // Check if exists
  const existing = await db
    .select()
    .from(schema.systemConfig)
    .where(eq(schema.systemConfig.key, AUTONOMY_CONFIG_KEY))
    .limit(1);

  if (existing.length > 0) {
    await db
      .update(schema.systemConfig)
      .set({ value, updatedAt: now })
      .where(eq(schema.systemConfig.key, AUTONOMY_CONFIG_KEY));
  } else {
    await db.insert(schema.systemConfig).values({
      id: nanoid(),
      key: AUTONOMY_CONFIG_KEY,
      value,
      updatedAt: now,
    });
  }

  cachedConfig = updated;
  logger.info({ level: updated.level }, 'Autonomy config updated');

  return updated;
}

export function getAutonomyConfig(): AutonomyConfig {
  if (!cachedConfig) {
    // Return defaults synchronously, but log warning
    logger.warn('Autonomy config not loaded, using defaults');
    return { ...DEFAULT_AUTONOMY_CONFIG };
  }
  return cachedConfig;
}

export function clearAutonomyCache(): void {
  cachedConfig = null;
}

// Helper functions for checking permissions
export function canCreateAgentAutonomously(): boolean {
  const config = getAutonomyConfig();
  return config.canCreateAgents && config.level !== 'manual';
}

export function canGenerateSkillAutonomously(): boolean {
  const config = getAutonomyConfig();
  return config.canGenerateSkills && config.level !== 'manual';
}

export function canGenerateToolAutonomously(): boolean {
  const config = getAutonomyConfig();
  return config.canGenerateTools && config.level !== 'manual';
}

export function requiresApprovalForTask(priority: number): boolean {
  const config = getAutonomyConfig();
  const policy = config.requireApprovalFor.taskExecution;

  if (config.level === 'autonomous') return false;
  if (config.level === 'manual') return true;

  // supervised mode
  switch (policy) {
    case 'none':
      return false;
    case 'high_priority':
      return priority >= 3; // Priority 3 (HIGH) and 4 (CRITICAL) require approval
    case 'all':
      return true;
    default:
      return false;
  }
}

export function requiresApprovalForAgentCreation(): boolean {
  const config = getAutonomyConfig();
  if (config.level === 'autonomous') return false;
  if (config.level === 'manual') return true;
  return config.requireApprovalFor.agentCreation;
}

export function requiresApprovalForSkillGeneration(): boolean {
  const config = getAutonomyConfig();
  if (config.level === 'autonomous') return false;
  if (config.level === 'manual') return true;
  return config.requireApprovalFor.skillGeneration;
}

export function requiresApprovalForToolGeneration(): boolean {
  const config = getAutonomyConfig();
  if (config.level === 'autonomous') return false;
  if (config.level === 'manual') return true;
  return config.requireApprovalFor.toolGeneration;
}
