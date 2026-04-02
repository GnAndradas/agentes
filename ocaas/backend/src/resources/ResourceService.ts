/**
 * Resource Service
 *
 * Unified access layer for Skills and Tools.
 * Delegates to existing SkillService and ToolService internally.
 */

import type { SkillService } from '../services/SkillService.js';
import type { ToolService } from '../services/ToolService.js';
import {
  RESOURCE_TYPE,
  type ResourceType,
  type Resource,
  type SkillResource,
  type ToolResource,
  type ResourceListResponse,
  type ResourceFilter,
  isResourceActive,
} from './ResourceTypes.js';
import {
  mapSkillsToResources,
  mapToolsToResources,
  mapSkillToResource,
  mapToolToResource,
} from './ResourceMapper.js';
import { createLogger } from '../utils/logger.js';
import { NotFoundError } from '../utils/errors.js';

const logger = createLogger('ResourceService');

/**
 * Unified Resource Service
 *
 * Provides a single interface to query Skills and Tools together.
 * Does NOT replace or duplicate logic from existing services.
 */
export class ResourceService {
  constructor(
    private skillService: SkillService,
    private toolService: ToolService
  ) {}

  // ===========================================================================
  // QUERY METHODS
  // ===========================================================================

  /**
   * Get all resources (skills and tools)
   * When includeToolCounts is true, skills include their tool counts
   */
  async getAllResources(includeToolCounts = false): Promise<ResourceListResponse> {
    const [skills, tools] = await Promise.all([
      includeToolCounts
        ? this.skillService.listWithToolCounts()
        : this.skillService.list(),
      this.toolService.list(),
    ]);

    const skillResources = mapSkillsToResources(skills);
    const toolResources = mapToolsToResources(tools);

    return {
      skills: skillResources,
      tools: toolResources,
      total: skillResources.length + toolResources.length,
    };
  }

  /**
   * Get resources by type
   */
  async getResourcesByType(type: ResourceType): Promise<Resource[]> {
    switch (type) {
      case RESOURCE_TYPE.SKILL: {
        const skills = await this.skillService.list();
        return mapSkillsToResources(skills);
      }
      case RESOURCE_TYPE.TOOL: {
        const tools = await this.toolService.list();
        return mapToolsToResources(tools);
      }
      default:
        throw new Error(`Unknown resource type: ${type}`);
    }
  }

  /**
   * Get a resource by ID
   * Searches both skills and tools
   */
  async getResourceById(id: string): Promise<Resource> {
    // Try skill first
    try {
      const skill = await this.skillService.getById(id);
      return mapSkillToResource(skill);
    } catch (err) {
      if (!(err instanceof NotFoundError)) throw err;
    }

    // Try tool
    try {
      const tool = await this.toolService.getById(id);
      return mapToolToResource(tool);
    } catch (err) {
      if (!(err instanceof NotFoundError)) throw err;
    }

    throw new NotFoundError('Resource', id);
  }

  /**
   * Get a resource by ID with known type (more efficient)
   */
  async getResourceByIdAndType(id: string, type: ResourceType): Promise<Resource> {
    switch (type) {
      case RESOURCE_TYPE.SKILL: {
        const skill = await this.skillService.getById(id);
        return mapSkillToResource(skill);
      }
      case RESOURCE_TYPE.TOOL: {
        const tool = await this.toolService.getById(id);
        return mapToolToResource(tool);
      }
      default:
        throw new Error(`Unknown resource type: ${type}`);
    }
  }

  /**
   * Get resources with filters
   */
  async getResourcesFiltered(filter: ResourceFilter): Promise<Resource[]> {
    let resources: Resource[] = [];

    // Fetch based on type filter
    if (!filter.type || filter.type === RESOURCE_TYPE.SKILL) {
      const skills = filter.activeOnly
        ? await this.skillService.getActive()
        : await this.skillService.list();
      resources.push(...mapSkillsToResources(skills));
    }

    if (!filter.type || filter.type === RESOURCE_TYPE.TOOL) {
      const tools = filter.activeOnly
        ? await this.toolService.getActive()
        : await this.toolService.list();
      resources.push(...mapToolsToResources(tools));
    }

    // Apply status filter
    if (filter.status) {
      resources = resources.filter(r => r.status === filter.status);
    }

    // Apply name pattern filter
    if (filter.namePattern) {
      const pattern = filter.namePattern.toLowerCase();
      resources = resources.filter(r => r.name.toLowerCase().includes(pattern));
    }

    return resources;
  }

  // ===========================================================================
  // AGGREGATION METHODS
  // ===========================================================================

  /**
   * Get resource counts by type
   */
  async getResourceCounts(): Promise<{ skills: number; tools: number; total: number }> {
    const [skills, tools] = await Promise.all([
      this.skillService.list(),
      this.toolService.list(),
    ]);

    return {
      skills: skills.length,
      tools: tools.length,
      total: skills.length + tools.length,
    };
  }

  /**
   * Get active resource counts
   */
  async getActiveResourceCounts(): Promise<{ skills: number; tools: number; total: number }> {
    const [skills, tools] = await Promise.all([
      this.skillService.getActive(),
      this.toolService.getActive(),
    ]);

    return {
      skills: skills.length,
      tools: tools.length,
      total: skills.length + tools.length,
    };
  }

  /**
   * Search resources by name
   */
  async searchByName(query: string): Promise<Resource[]> {
    const allResources = await this.getAllResources();
    const lowerQuery = query.toLowerCase();

    const matchingSkills = allResources.skills.filter(
      r => r.name.toLowerCase().includes(lowerQuery)
    );
    const matchingTools = allResources.tools.filter(
      r => r.name.toLowerCase().includes(lowerQuery)
    );

    return [...matchingSkills, ...matchingTools];
  }

  /**
   * Get resources assigned to an agent
   */
  async getAgentResources(agentId: string): Promise<{ skills: SkillResource[]; tools: ToolResource[] }> {
    const [skills, tools] = await Promise.all([
      this.skillService.getAgentSkills(agentId),
      this.toolService.getAgentTools(agentId),
    ]);

    return {
      skills: mapSkillsToResources(skills),
      tools: mapToolsToResources(tools),
    };
  }
}

// =============================================================================
// SINGLETON
// =============================================================================

let instance: ResourceService | null = null;

/**
 * Initialize the ResourceService singleton
 */
export function initResourceService(
  skillService: SkillService,
  toolService: ToolService
): ResourceService {
  if (!instance) {
    instance = new ResourceService(skillService, toolService);
    logger.info('ResourceService initialized');
  }
  return instance;
}

/**
 * Get the ResourceService singleton
 */
export function getResourceService(): ResourceService {
  if (!instance) {
    throw new Error('ResourceService not initialized. Call initResourceService first.');
  }
  return instance;
}

/**
 * Reset the singleton (for testing)
 */
export function resetResourceService(): void {
  instance = null;
}
