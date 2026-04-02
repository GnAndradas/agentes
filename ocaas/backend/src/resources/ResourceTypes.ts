/**
 * Unified Resource Types
 *
 * Provides a common interface for Skills and Tools without replacing
 * existing domain types. This is an abstraction layer for unified access.
 */

import type { SkillDTO, SkillStatus, ToolDTO, ToolStatus, ToolType } from '../types/domain.js';

// =============================================================================
// RESOURCE TYPE CONSTANTS
// =============================================================================

export const RESOURCE_TYPE = {
  SKILL: 'skill',
  TOOL: 'tool',
} as const;

export type ResourceType = typeof RESOURCE_TYPE[keyof typeof RESOURCE_TYPE];

// =============================================================================
// BASE RESOURCE INTERFACE
// =============================================================================

/**
 * Unified resource interface that abstracts Skills and Tools
 * Contains only common properties shared by both resource types.
 */
export interface BaseResource {
  /** Unique resource identifier */
  id: string;

  /** Resource type discriminator */
  type: ResourceType;

  /** Human-readable name */
  name: string;

  /** Optional description */
  description?: string;

  /** Semantic version (e.g., "1.0.0") */
  version: string;

  /** Resource status (active, inactive, deprecated) */
  status: string;

  /** File path in workspace */
  path: string;

  /** Configuration object */
  config?: Record<string, unknown>;

  /** Last sync timestamp with workspace */
  syncedAt?: number;

  /** Creation timestamp */
  createdAt: number;

  /** Last update timestamp */
  updatedAt: number;
}

// =============================================================================
// EXTENDED RESOURCE TYPES
// =============================================================================

/**
 * Skill resource with skill-specific properties
 */
export interface SkillResource extends BaseResource {
  type: typeof RESOURCE_TYPE.SKILL;

  /** Skill capabilities (e.g., ["code_review", "testing"]) */
  capabilities?: string[];

  /** Required dependencies */
  requirements?: string[];

  /** Number of tools linked to this skill */
  toolCount?: number;

  /** IDs of linked tools (when expanded) */
  linkedToolIds?: string[];
}

/**
 * Tool resource with tool-specific properties
 */
export interface ToolResource extends BaseResource {
  type: typeof RESOURCE_TYPE.TOOL;

  /** Tool execution type */
  toolType: ToolType;

  /** JSON Schema for input validation */
  inputSchema?: Record<string, unknown>;

  /** JSON Schema for output validation */
  outputSchema?: Record<string, unknown>;

  /** Number of times this tool has been executed */
  executionCount: number;

  /** Last execution timestamp */
  lastExecutedAt?: number;
}

/**
 * Union type for any resource
 */
export type Resource = SkillResource | ToolResource;

// =============================================================================
// RESPONSE TYPES
// =============================================================================

/**
 * Response for GET /api/resources
 */
export interface ResourceListResponse {
  skills: SkillResource[];
  tools: ToolResource[];
  total: number;
}

/**
 * Filter options for resource queries
 */
export interface ResourceFilter {
  /** Filter by resource type */
  type?: ResourceType;

  /** Filter by status */
  status?: string;

  /** Filter by name pattern (case-insensitive contains) */
  namePattern?: string;

  /** Include only active resources */
  activeOnly?: boolean;
}

// =============================================================================
// TYPE GUARDS
// =============================================================================

/**
 * Check if a resource is a SkillResource
 */
export function isSkillResource(resource: Resource): resource is SkillResource {
  return resource.type === RESOURCE_TYPE.SKILL;
}

/**
 * Check if a resource is a ToolResource
 */
export function isToolResource(resource: Resource): resource is ToolResource {
  return resource.type === RESOURCE_TYPE.TOOL;
}

// =============================================================================
// STATUS HELPERS
// =============================================================================

/**
 * Normalize different status enums to a common string
 */
export function normalizeStatus(status: SkillStatus | ToolStatus): string {
  return status;
}

/**
 * Check if a resource is active
 */
export function isResourceActive(resource: Resource): boolean {
  return resource.status === 'active';
}
