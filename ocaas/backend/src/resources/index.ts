/**
 * Resource Layer
 *
 * Unified abstraction for Skills and Tools.
 * Provides common interface without replacing existing services.
 */

// Types
export {
  RESOURCE_TYPE,
  type ResourceType,
  type BaseResource,
  type SkillResource,
  type ToolResource,
  type Resource,
  type ResourceListResponse,
  type ResourceFilter,
  isSkillResource,
  isToolResource,
  normalizeStatus,
  isResourceActive,
} from './ResourceTypes.js';

// Mapper
export {
  mapSkillToResource,
  mapToolToResource,
  mapSkillsToResources,
  mapToolsToResources,
  mapToResource,
  extractSkillData,
  extractToolData,
} from './ResourceMapper.js';

// Service
export {
  ResourceService,
  initResourceService,
  getResourceService,
  resetResourceService,
} from './ResourceService.js';
