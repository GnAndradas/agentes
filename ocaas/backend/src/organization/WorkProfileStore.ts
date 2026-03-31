/**
 * Work Profile Store
 *
 * Manages work profiles (presets and custom)
 */

import { createLogger } from '../utils/logger.js';
import { nowTimestamp } from '../utils/helpers.js';
import type { WorkProfile, WorkProfilePreset } from './types.js';

const logger = createLogger('WorkProfileStore');

// =============================================================================
// PRESET PROFILES
// =============================================================================

function createPresetProfile(
  id: string,
  name: string,
  preset: WorkProfilePreset,
  description: string,
  config: Partial<WorkProfile>
): WorkProfile {
  const now = nowTimestamp();
  return {
    id,
    name,
    description,
    preset,
    editable: false,
    retry: {
      maxRetries: 3,
      retryDelayMs: 5000,
      backoffMultiplier: 2,
    },
    delegation: {
      aggressiveness: 0.5,
      preferDelegation: false,
      maxDepth: 3,
    },
    splitting: {
      enabled: true,
      minComplexityToSplit: 6,
      maxSubtasks: 5,
    },
    resourceCreation: {
      autoCreate: false,
      allowedTypes: ['skill', 'tool'],
      requireApproval: true,
    },
    escalation: {
      triggers: ['failure_count', 'timeout', 'blocked'],
      failureThreshold: 3,
      timeoutThreshold: 300000,
      notifyHuman: true,
    },
    humanApproval: {
      priorityThreshold: 4,
      complexityThreshold: 8,
      requiredForTypes: [],
    },
    createdAt: now,
    updatedAt: now,
    ...config,
  };
}

const PRESET_PROFILES: WorkProfile[] = [
  createPresetProfile(
    'conservative',
    'Conservative',
    'conservative',
    'Minimal automation, human oversight for most decisions',
    {
      delegation: {
        aggressiveness: 0.2,
        preferDelegation: false,
        maxDepth: 1,
      },
      splitting: {
        enabled: false,
        minComplexityToSplit: 10,
        maxSubtasks: 3,
      },
      resourceCreation: {
        autoCreate: false,
        allowedTypes: [],
        requireApproval: true,
      },
      escalation: {
        triggers: ['failure_count', 'blocked'],
        failureThreshold: 1,
        timeoutThreshold: 120000,
        notifyHuman: true,
      },
      humanApproval: {
        priorityThreshold: 2,
        complexityThreshold: 4,
        requiredForTypes: ['critical', 'security', 'financial'],
      },
    }
  ),

  createPresetProfile(
    'balanced',
    'Balanced',
    'balanced',
    'Moderate automation with human checkpoints for important decisions',
    {
      delegation: {
        aggressiveness: 0.5,
        preferDelegation: false,
        maxDepth: 3,
      },
      splitting: {
        enabled: true,
        minComplexityToSplit: 6,
        maxSubtasks: 5,
      },
      resourceCreation: {
        autoCreate: true,
        allowedTypes: ['skill', 'tool'],
        requireApproval: true,
      },
      escalation: {
        triggers: ['failure_count', 'timeout', 'blocked'],
        failureThreshold: 3,
        timeoutThreshold: 300000,
        notifyHuman: true,
      },
      humanApproval: {
        priorityThreshold: 4,
        complexityThreshold: 7,
        requiredForTypes: ['security', 'financial'],
      },
    }
  ),

  createPresetProfile(
    'aggressive',
    'Aggressive',
    'aggressive',
    'Maximum automation, human oversight only for critical tasks',
    {
      delegation: {
        aggressiveness: 0.8,
        preferDelegation: true,
        maxDepth: 5,
      },
      splitting: {
        enabled: true,
        minComplexityToSplit: 4,
        maxSubtasks: 10,
      },
      resourceCreation: {
        autoCreate: true,
        allowedTypes: ['agent', 'skill', 'tool'],
        requireApproval: false,
      },
      escalation: {
        triggers: ['failure_count', 'blocked'],
        failureThreshold: 5,
        timeoutThreshold: 600000,
        notifyHuman: false,
      },
      humanApproval: {
        priorityThreshold: 4,
        complexityThreshold: 10,
        requiredForTypes: [],
      },
    }
  ),

  createPresetProfile(
    'human_first',
    'Human First',
    'human_first',
    'Human approval required for all significant actions',
    {
      delegation: {
        aggressiveness: 0.1,
        preferDelegation: false,
        maxDepth: 1,
      },
      splitting: {
        enabled: false,
        minComplexityToSplit: 10,
        maxSubtasks: 2,
      },
      resourceCreation: {
        autoCreate: false,
        allowedTypes: [],
        requireApproval: true,
      },
      escalation: {
        triggers: ['failure_count', 'timeout', 'complexity', 'blocked'],
        failureThreshold: 1,
        timeoutThreshold: 60000,
        notifyHuman: true,
      },
      humanApproval: {
        priorityThreshold: 1,
        complexityThreshold: 1,
        requiredForTypes: ['*'],
      },
    }
  ),

  createPresetProfile(
    'autonomous_first',
    'Autonomous First',
    'autonomous_first',
    'Full autonomy with minimal human intervention',
    {
      delegation: {
        aggressiveness: 1.0,
        preferDelegation: true,
        maxDepth: 10,
      },
      splitting: {
        enabled: true,
        minComplexityToSplit: 3,
        maxSubtasks: 15,
      },
      resourceCreation: {
        autoCreate: true,
        allowedTypes: ['agent', 'skill', 'tool'],
        requireApproval: false,
      },
      escalation: {
        triggers: ['blocked'],
        failureThreshold: 10,
        timeoutThreshold: 3600000,
        notifyHuman: false,
      },
      humanApproval: {
        priorityThreshold: 5,
        complexityThreshold: 10,
        requiredForTypes: [],
      },
    }
  ),
];

// =============================================================================
// STORE
// =============================================================================

export class WorkProfileStore {
  private customProfiles = new Map<string, WorkProfile>();

  constructor() {
    logger.info({ presetCount: PRESET_PROFILES.length }, 'WorkProfileStore initialized');
  }

  /**
   * Get all profiles (presets + custom)
   */
  list(): WorkProfile[] {
    return [...PRESET_PROFILES, ...Array.from(this.customProfiles.values())];
  }

  /**
   * Get profile by ID
   */
  get(id: string): WorkProfile | null {
    const preset = PRESET_PROFILES.find(p => p.id === id);
    if (preset) return preset;
    return this.customProfiles.get(id) ?? null;
  }

  /**
   * Get preset profiles only
   */
  getPresets(): WorkProfile[] {
    return [...PRESET_PROFILES];
  }

  /**
   * Create a custom profile
   */
  create(input: Omit<WorkProfile, 'id' | 'editable' | 'createdAt' | 'updatedAt'>): WorkProfile {
    const now = nowTimestamp();
    const id = `custom_${now}_${Math.random().toString(36).slice(2, 8)}`;

    const profile: WorkProfile = {
      ...input,
      id,
      editable: true,
      createdAt: now,
      updatedAt: now,
    };

    this.customProfiles.set(id, profile);
    logger.info({ profileId: id, name: profile.name }, 'Custom profile created');
    return profile;
  }

  /**
   * Update a custom profile
   */
  update(id: string, updates: Partial<WorkProfile>): WorkProfile | null {
    const existing = this.customProfiles.get(id);
    if (!existing) {
      // Check if trying to update a preset
      if (PRESET_PROFILES.find(p => p.id === id)) {
        logger.warn({ profileId: id }, 'Cannot update preset profile');
        return null;
      }
      return null;
    }

    const updated: WorkProfile = {
      ...existing,
      ...updates,
      id: existing.id, // Prevent ID change
      editable: true,
      createdAt: existing.createdAt,
      updatedAt: nowTimestamp(),
    };

    this.customProfiles.set(id, updated);
    logger.info({ profileId: id }, 'Profile updated');
    return updated;
  }

  /**
   * Delete a custom profile
   */
  delete(id: string): boolean {
    if (PRESET_PROFILES.find(p => p.id === id)) {
      logger.warn({ profileId: id }, 'Cannot delete preset profile');
      return false;
    }
    const deleted = this.customProfiles.delete(id);
    if (deleted) {
      logger.info({ profileId: id }, 'Profile deleted');
    }
    return deleted;
  }

  /**
   * Clone a profile as a new custom profile
   */
  clone(sourceId: string, newName: string): WorkProfile | null {
    const source = this.get(sourceId);
    if (!source) return null;

    return this.create({
      name: newName,
      description: `Clone of ${source.name}`,
      preset: 'custom',
      retry: { ...source.retry },
      delegation: { ...source.delegation },
      splitting: { ...source.splitting },
      resourceCreation: { ...source.resourceCreation },
      escalation: { ...source.escalation },
      humanApproval: { ...source.humanApproval },
    });
  }

  /**
   * Get default profile ID
   */
  getDefaultProfileId(): string {
    return 'balanced';
  }
}

// Singleton
let storeInstance: WorkProfileStore | null = null;

export function getWorkProfileStore(): WorkProfileStore {
  if (!storeInstance) {
    storeInstance = new WorkProfileStore();
  }
  return storeInstance;
}
