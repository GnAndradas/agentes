/**
 * Organization Module
 *
 * Provides organizational layer for agent hierarchy, roles, work profiles,
 * and policy-based decision making.
 */

// Types
export * from './types.js';

// Stores
export { WorkProfileStore, getWorkProfileStore } from './WorkProfileStore.js';
export { AgentHierarchyStore, getAgentHierarchyStore } from './AgentHierarchyStore.js';
export { TaskMemoryStore, getTaskMemoryStore } from './TaskMemoryStore.js';

// Services
export {
  OrganizationalPolicyService,
  getOrganizationalPolicyService,
} from './OrganizationalPolicyService.js';
