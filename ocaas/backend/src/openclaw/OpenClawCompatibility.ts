/**
 * OpenClaw Compatibility Module (BLOQUE 8)
 *
 * Documents and validates the REAL compatibility between OCAAS and OpenClaw.
 *
 * IMPORTANT FINDINGS:
 * - OpenClaw uses /v1/chat/completions (chat_completion mode)
 * - Skills/tools passed to spawn() are IGNORED
 * - Agent workspace files are NOT read by chat_completion
 * - Session IDs are LOCAL to OCAAS, not OpenClaw sessions
 * - Tool execution via gateway.exec() uses prompt, not script execution
 *
 * This module provides:
 * 1. Compatibility checks
 * 2. Structure validation for what OpenClaw ACTUALLY uses
 * 3. Gap documentation
 */

import { existsSync } from 'fs';
import { join } from 'path';
import { config } from '../config/index.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('OpenClawCompatibility');

// ============================================================================
// WHAT OPENCLAW ACTUALLY USES
// ============================================================================

/**
 * What OpenClaw ACTUALLY uses from OCAAS
 *
 * BLOQUE 8: Honest documentation of real usage
 */
export interface OpenClawRealUsage {
  /** Chat completion endpoint */
  chatCompletion: {
    endpoint: '/v1/chat/completions';
    format: 'openai';
    usesSystemPrompt: boolean;
    usesUserPrompt: boolean;
  };

  /** Skills - how they're ACTUALLY used */
  skills: {
    /** Written to workspace? */
    writtenToWorkspace: boolean;
    /** Read by OpenClaw? */
    readByOpenClaw: false;  // NEVER
    /** How they're used */
    actualUsage: 'included_in_prompt' | 'ignored';
    /** Gap */
    gap: string;
  };

  /** Tools - how they're ACTUALLY used */
  tools: {
    /** Written to workspace? */
    writtenToWorkspace: boolean;
    /** Executed by OpenClaw? */
    executedByOpenClaw: false;  // NEVER
    /** How they're used */
    actualUsage: 'mentioned_in_prompt' | 'ignored';
    /** Gap */
    gap: string;
  };

  /** Agent - how it's ACTUALLY used */
  agent: {
    /** Workspace created? */
    workspaceCreated: boolean;
    /** Config read by OpenClaw? */
    configReadByOpenClaw: false;  // NEVER
    /** System prompt used? */
    systemPromptUsed: 'embedded_in_request';
    /** Gap */
    gap: string;
  };
}

/**
 * Real usage documentation
 */
export const OPENCLAW_REAL_USAGE: OpenClawRealUsage = {
  chatCompletion: {
    endpoint: '/v1/chat/completions',
    format: 'openai',
    usesSystemPrompt: true,
    usesUserPrompt: true,
  },
  skills: {
    writtenToWorkspace: true,
    readByOpenClaw: false,
    actualUsage: 'ignored',
    gap: 'Skills written to workspace/skills/{name}/ but OpenClaw chat_completion does NOT read them. They exist as metadata only.',
  },
  tools: {
    writtenToWorkspace: true,
    executedByOpenClaw: false,
    actualUsage: 'ignored',
    gap: 'Tools written to workspace/tools/{name}.sh but OpenClaw chat_completion does NOT execute them. gateway.exec() uses prompt, not script execution.',
  },
  agent: {
    workspaceCreated: true,
    configReadByOpenClaw: false,
    systemPromptUsed: 'embedded_in_request',
    gap: 'Agent workspace (agent.json, system-prompt.md) NOT read by OpenClaw. System prompt embedded in chat completion request.',
  },
};

// ============================================================================
// STRUCTURE VALIDATION (what OCAAS should check)
// ============================================================================

/**
 * Required skill structure
 *
 * Note: OpenClaw doesn't use this, but OCAAS sync requires it
 */
export const SKILL_REQUIRED_FILES = ['SKILL.md', 'agent-instructions.md'] as const;

/**
 * Required tool structure
 *
 * Note: OpenClaw doesn't execute these
 */
export interface ToolRequirements {
  /** Valid extensions */
  extensions: ['.sh', '.py'];
  /** Must be executable (on Unix) */
  executable: boolean;
  /** Must have shebang */
  hasShebang: boolean;
  /** Must have set -euo pipefail (for sh) */
  hasStrictMode: boolean;
}

export const TOOL_REQUIREMENTS: ToolRequirements = {
  extensions: ['.sh', '.py'],
  executable: true,
  hasShebang: true,
  hasStrictMode: true,
};

/**
 * Required agent structure
 */
export const AGENT_REQUIRED_FILES = ['agent.json', 'system-prompt.md'] as const;

// ============================================================================
// COMPATIBILITY CHECKS
// ============================================================================

/**
 * Compatibility check result
 */
export interface CompatibilityCheck {
  /** Resource type */
  type: 'skill' | 'tool' | 'agent';
  /** Resource name */
  name: string;
  /** Is structurally valid for OCAAS? */
  ocaasValid: boolean;
  /** Would OpenClaw use it? */
  openclawUsed: boolean;
  /** Reason if not valid */
  errors: string[];
  /** Warnings (valid but issues) */
  warnings: string[];
  /** Gap explanation */
  gap: string;
}

/**
 * Check skill compatibility
 */
export function checkSkillCompatibility(name: string): CompatibilityCheck {
  const workspacePath = config.openclaw.workspacePath;
  const skillPath = join(workspacePath, 'skills', name);
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check OCAAS structure
  let ocaasValid = true;
  if (!existsSync(skillPath)) {
    ocaasValid = false;
    errors.push(`Skill directory not found: ${skillPath}`);
  } else {
    for (const file of SKILL_REQUIRED_FILES) {
      if (!existsSync(join(skillPath, file))) {
        ocaasValid = false;
        errors.push(`Missing required file: ${file}`);
      }
    }
  }

  // OpenClaw NEVER uses skills
  warnings.push('OpenClaw chat_completion does NOT read skill files');

  return {
    type: 'skill',
    name,
    ocaasValid,
    openclawUsed: false,
    errors,
    warnings,
    gap: OPENCLAW_REAL_USAGE.skills.gap,
  };
}

/**
 * Check tool compatibility
 */
export function checkToolCompatibility(name: string): CompatibilityCheck {
  const workspacePath = config.openclaw.workspacePath;
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check for tool file
  let ocaasValid = false;
  let toolPath = '';
  for (const ext of TOOL_REQUIREMENTS.extensions) {
    const path = join(workspacePath, 'tools', `${name}${ext}`);
    if (existsSync(path)) {
      ocaasValid = true;
      toolPath = path;
      break;
    }
  }

  if (!ocaasValid) {
    errors.push(`Tool script not found: workspace/tools/${name}.sh or .py`);
  }

  // OpenClaw NEVER executes tools
  warnings.push('OpenClaw chat_completion does NOT execute tool scripts');
  warnings.push('gateway.exec() uses prompt, not actual script execution');

  return {
    type: 'tool',
    name,
    ocaasValid,
    openclawUsed: false,
    errors,
    warnings,
    gap: OPENCLAW_REAL_USAGE.tools.gap,
  };
}

/**
 * Check agent compatibility
 */
export function checkAgentCompatibility(name: string): CompatibilityCheck {
  const workspacePath = config.openclaw.workspacePath;
  const agentPath = join(workspacePath, 'agents', name);
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check OCAAS structure
  let ocaasValid = true;
  if (!existsSync(agentPath)) {
    ocaasValid = false;
    errors.push(`Agent workspace not found: ${agentPath}`);
  } else {
    for (const file of AGENT_REQUIRED_FILES) {
      if (!existsSync(join(agentPath, file))) {
        ocaasValid = false;
        errors.push(`Missing required file: ${file}`);
      }
    }
  }

  // OpenClaw NEVER reads agent workspace
  warnings.push('OpenClaw chat_completion does NOT read agent.json');
  warnings.push('System prompt is embedded in request, not read from file');

  return {
    type: 'agent',
    name,
    ocaasValid,
    openclawUsed: false,
    errors,
    warnings,
    gap: OPENCLAW_REAL_USAGE.agent.gap,
  };
}

// ============================================================================
// IGNORED FIELDS DOCUMENTATION
// ============================================================================

/**
 * Fields passed to OpenClaw but IGNORED
 *
 * BLOQUE 8: Honest documentation
 */
export interface IgnoredFieldsMap {
  spawn: string[];
  send: string[];
  exec: string[];
}

export const IGNORED_FIELDS: IgnoredFieldsMap = {
  spawn: [
    'tools',     // Passed but ignored - not sent to OpenClaw
    'skills',    // Passed but ignored - not sent to OpenClaw
    'config',    // Passed but partially used (may affect prompt building)
  ],
  send: [
    'sessionId', // Used for logging but OpenClaw doesn't recognize it
    'data',      // May be ignored depending on implementation
  ],
  exec: [
    'sessionId', // Used for logging but OpenClaw doesn't recognize it
    'toolName',  // Used to build prompt, not actual tool execution
    'input',     // Included in prompt as JSON, not passed to script
  ],
};

/**
 * Log ignored fields warning
 */
export function logIgnoredFieldsWarning(operation: keyof IgnoredFieldsMap): void {
  const fields = IGNORED_FIELDS[operation];
  if (fields.length > 0) {
    logger.warn({
      operation,
      ignoredFields: fields,
    }, `BLOQUE 8: Fields passed to ${operation}() are IGNORED by OpenClaw`);
  }
}

// ============================================================================
// UNIFIED STRUCTURE VALIDATION
// ============================================================================

/**
 * Validate resource structure (manual or auto-generated)
 *
 * BLOQUE 8: Unified validation for both paths
 */
export interface StructureValidation {
  valid: boolean;
  errors: string[];
  warnings: string[];
  openclawCompatible: boolean;
  gap?: string;
}

/**
 * Validate skill structure
 *
 * Same rules for manual and auto-generated
 */
export function validateSkillStructure(files: Record<string, string>): StructureValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check required files
  for (const required of SKILL_REQUIRED_FILES) {
    if (!files[required]) {
      errors.push(`Missing required file: ${required}`);
    }
  }

  // Check SKILL.md structure
  const skillMd = files['SKILL.md'];
  if (skillMd) {
    if (!skillMd.includes('# ')) {
      warnings.push('SKILL.md should have a title (# Name)');
    }
    if (!skillMd.includes('## Capabilities')) {
      warnings.push('SKILL.md should have ## Capabilities section');
    }
  }

  // Check agent-instructions.md structure
  const instructions = files['agent-instructions.md'];
  if (instructions) {
    if (!instructions.includes('# ')) {
      warnings.push('agent-instructions.md should have a title');
    }
  }

  // OpenClaw doesn't use skills
  warnings.push('OpenClaw chat_completion does NOT read these files');

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    openclawCompatible: false, // Skills are never used by chat_completion
    gap: OPENCLAW_REAL_USAGE.skills.gap,
  };
}

/**
 * Validate tool structure
 *
 * Same rules for manual and auto-generated
 */
export function validateToolStructure(
  content: string,
  type: 'sh' | 'py'
): StructureValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check shebang
  if (type === 'sh') {
    if (!content.startsWith('#!/bin/bash') && !content.startsWith('#!/usr/bin/env bash')) {
      errors.push('Shell script must start with #!/bin/bash or #!/usr/bin/env bash');
    }
    if (!content.includes('set -euo pipefail')) {
      warnings.push('Shell script should include "set -euo pipefail" for strict mode');
    }
  } else if (type === 'py') {
    if (!content.startsWith('#!/usr/bin/env python3') && !content.startsWith('#!/usr/bin/python3')) {
      warnings.push('Python script should start with #!/usr/bin/env python3');
    }
  }

  // Check for dangerous patterns
  const DANGEROUS_PATTERNS = [
    'rm -rf /',
    'sudo ',
    ':(){',
    'dd if=',
    'mkfs',
    '> /dev/sd',
    'chmod 777',
    'curl.*\\| bash',
    'eval.*\\$',
  ];

  for (const pattern of DANGEROUS_PATTERNS) {
    const regex = new RegExp(pattern, 'i');
    if (regex.test(content)) {
      errors.push(`Dangerous pattern detected: ${pattern}`);
    }
  }

  // Check for basic structure
  if (content.length < 50) {
    warnings.push('Tool script seems too short');
  }

  // OpenClaw doesn't execute tools
  warnings.push('OpenClaw chat_completion does NOT execute this script');

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    openclawCompatible: false, // Tools are never executed by chat_completion
    gap: OPENCLAW_REAL_USAGE.tools.gap,
  };
}

/**
 * Validate agent structure
 *
 * Same rules for manual and auto-generated
 */
export function validateAgentStructure(
  agentConfig: Record<string, unknown>,
  systemPrompt: string
): StructureValidation {
  const errors: string[] = [];
  const warnings: string[] = [];

  // Check required agent fields
  if (!agentConfig.name || typeof agentConfig.name !== 'string') {
    errors.push('Agent config must have "name" (string)');
  }

  if (!agentConfig.type || !['general', 'specialist', 'orchestrator'].includes(agentConfig.type as string)) {
    warnings.push('Agent config should have valid "type" (general, specialist, orchestrator)');
  }

  // Check system prompt
  if (!systemPrompt || systemPrompt.length < 10) {
    warnings.push('System prompt seems too short');
  }

  // OpenClaw doesn't read workspace files
  warnings.push('OpenClaw chat_completion does NOT read agent.json from workspace');
  warnings.push('System prompt is embedded in request, not read from file');

  return {
    valid: errors.length === 0,
    errors,
    warnings,
    openclawCompatible: true, // Agent system prompt IS used (embedded in request)
    gap: OPENCLAW_REAL_USAGE.agent.gap,
  };
}

// ============================================================================
// COMPATIBILITY SUMMARY
// ============================================================================

/**
 * Get full compatibility summary
 */
export function getCompatibilitySummary(): {
  model: 'chat_completion';
  skills: { used: false; gap: string };
  tools: { used: false; gap: string };
  agents: { workspaceUsed: false; systemPromptUsed: true; gap: string };
  sessions: { real: false; gap: string };
} {
  return {
    model: 'chat_completion',
    skills: {
      used: false,
      gap: OPENCLAW_REAL_USAGE.skills.gap,
    },
    tools: {
      used: false,
      gap: OPENCLAW_REAL_USAGE.tools.gap,
    },
    agents: {
      workspaceUsed: false,
      systemPromptUsed: true,
      gap: OPENCLAW_REAL_USAGE.agent.gap,
    },
    sessions: {
      real: false,
      gap: 'Session IDs are LOCAL to OCAAS. OpenClaw chat_completion is stateless.',
    },
  };
}

/**
 * Log compatibility summary at startup
 */
export function logCompatibilitySummary(): void {
  const summary = getCompatibilitySummary();
  logger.info({
    model: summary.model,
    skillsUsed: summary.skills.used,
    toolsUsed: summary.tools.used,
    agentWorkspaceUsed: summary.agents.workspaceUsed,
    agentSystemPromptUsed: summary.agents.systemPromptUsed,
    realSessions: summary.sessions.real,
  }, 'BLOQUE 8: OpenClaw compatibility summary');
}
