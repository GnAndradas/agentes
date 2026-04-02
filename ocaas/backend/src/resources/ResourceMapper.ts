/**
 * Resource Mapper
 *
 * Transforms domain-specific DTOs (SkillDTO, ToolDTO) into unified
 * Resource types for the abstraction layer.
 */

import type { SkillDTO, ToolDTO } from '../types/domain.js';
import {
  RESOURCE_TYPE,
  type SkillResource,
  type ToolResource,
  type Resource,
} from './ResourceTypes.js';

// =============================================================================
// SKILL MAPPING
// =============================================================================

/**
 * Transform a SkillDTO to a SkillResource
 */
export function mapSkillToResource(skill: SkillDTO, linkedToolIds?: string[]): SkillResource {
  return {
    id: skill.id,
    type: RESOURCE_TYPE.SKILL,
    name: skill.name,
    description: skill.description,
    version: skill.version,
    status: skill.status,
    path: skill.path,
    config: skill.config,
    syncedAt: skill.syncedAt,
    createdAt: skill.createdAt,
    updatedAt: skill.updatedAt,
    // Skill-specific
    capabilities: skill.capabilities,
    requirements: skill.requirements,
    toolCount: skill.toolCount ?? linkedToolIds?.length,
    linkedToolIds,
  };
}

/**
 * Transform multiple SkillDTOs to SkillResources
 */
export function mapSkillsToResources(skills: SkillDTO[]): SkillResource[] {
  return skills.map((skill) => mapSkillToResource(skill));
}

// =============================================================================
// TOOL MAPPING
// =============================================================================

/**
 * Transform a ToolDTO to a ToolResource
 */
export function mapToolToResource(tool: ToolDTO): ToolResource {
  return {
    id: tool.id,
    type: RESOURCE_TYPE.TOOL,
    name: tool.name,
    description: tool.description,
    version: tool.version,
    status: tool.status,
    path: tool.path,
    config: tool.config,
    syncedAt: tool.syncedAt,
    createdAt: tool.createdAt,
    updatedAt: tool.updatedAt,
    // Tool-specific
    toolType: tool.type,
    inputSchema: tool.inputSchema,
    outputSchema: tool.outputSchema,
    executionCount: tool.executionCount,
    lastExecutedAt: tool.lastExecutedAt,
  };
}

/**
 * Transform multiple ToolDTOs to ToolResources
 */
export function mapToolsToResources(tools: ToolDTO[]): ToolResource[] {
  return tools.map(mapToolToResource);
}

// =============================================================================
// GENERIC MAPPING
// =============================================================================

/**
 * Map any supported DTO to its Resource type
 */
export function mapToResource(dto: SkillDTO | ToolDTO): Resource {
  // Discriminate by checking for skill-specific or tool-specific properties
  if ('capabilities' in dto || 'requirements' in dto) {
    return mapSkillToResource(dto as SkillDTO);
  }
  if ('inputSchema' in dto || 'outputSchema' in dto || 'executionCount' in dto) {
    return mapToolToResource(dto as ToolDTO);
  }

  // Fallback: check for 'type' field (ToolDTO has type as ToolType, SkillDTO doesn't)
  if ('type' in dto && typeof (dto as ToolDTO).type === 'string' &&
      ['script', 'binary', 'api'].includes((dto as ToolDTO).type)) {
    return mapToolToResource(dto as ToolDTO);
  }

  // Default to skill
  return mapSkillToResource(dto as SkillDTO);
}

// =============================================================================
// REVERSE MAPPING (for future use)
// =============================================================================

/**
 * Extract the original SkillDTO-compatible data from a SkillResource
 * Note: This creates a partial representation, not a full DTO
 */
export function extractSkillData(resource: SkillResource): Omit<SkillDTO, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    name: resource.name,
    description: resource.description,
    version: resource.version,
    status: resource.status as SkillDTO['status'],
    path: resource.path,
    config: resource.config,
    syncedAt: resource.syncedAt,
    capabilities: resource.capabilities,
    requirements: resource.requirements,
  };
}

/**
 * Extract the original ToolDTO-compatible data from a ToolResource
 * Note: This creates a partial representation, not a full DTO
 */
export function extractToolData(resource: ToolResource): Omit<ToolDTO, 'id' | 'createdAt' | 'updatedAt'> {
  return {
    name: resource.name,
    description: resource.description,
    version: resource.version,
    status: resource.status as ToolDTO['status'],
    path: resource.path,
    config: resource.config,
    syncedAt: resource.syncedAt,
    type: resource.toolType,
    inputSchema: resource.inputSchema,
    outputSchema: resource.outputSchema,
    executionCount: resource.executionCount,
    lastExecutedAt: resource.lastExecutedAt,
  };
}
