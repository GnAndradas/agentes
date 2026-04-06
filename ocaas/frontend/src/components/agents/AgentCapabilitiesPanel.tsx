/**
 * AgentCapabilitiesPanel
 *
 * Shows hierarchical view of Agent's capabilities:
 * Agent
 *  ├─ Skills
 *  │   ├─ Tool (required)
 *  │   └─ Tool (optional)
 *  └─ Direct Tools
 */

import { useState, useEffect } from 'react';
import {
  Sparkles,
  Wrench,
  ChevronDown,
  ChevronRight,
  AlertCircle,
} from 'lucide-react';
import { Badge } from '../ui';
import { skillApi } from '../../lib/api';
import type { Skill, Tool, SkillToolExpanded } from '../../types';

interface AgentCapabilitiesPanelProps {
  skills: Skill[] | null | undefined;
  directTools: Tool[] | null | undefined;
  isLoading?: boolean;
}

// Skill with its tools expanded
interface SkillWithTools extends Skill {
  expandedTools?: SkillToolExpanded[];
  toolsLoading?: boolean;
  toolsError?: string;
}

// =============================================================================
// SUB-COMPONENTS
// =============================================================================

function ToolStatusBadge({ status }: { status: Tool['status'] }) {
  const config = {
    active: { variant: 'active' as const, label: 'Active' },
    inactive: { variant: 'inactive' as const, label: 'Inactive' },
    error: { variant: 'error' as const, label: 'Error' },
    deprecated: { variant: 'pending' as const, label: 'Deprecated' },
  };
  const c = config[status] || config.inactive;
  return <Badge variant={c.variant} className="text-xs">{c.label}</Badge>;
}

function ToolRow({
  tool,
  required,
  role,
  indent = false,
}: {
  tool: Tool;
  required?: boolean;
  role?: string;
  indent?: boolean;
}) {
  return (
    <div
      className={`flex items-center justify-between py-2 px-3 bg-dark-900 rounded text-sm ${
        indent ? 'ml-6' : ''
      }`}
    >
      <div className="flex items-center gap-2 min-w-0">
        <Wrench className="w-4 h-4 text-cyan-400 flex-shrink-0" />
        <span className="font-medium truncate">{tool.name}</span>
        {required !== undefined && (
          <Badge
            variant={required ? 'active' : 'default'}
            className="text-xs"
          >
            {required ? 'Required' : 'Optional'}
          </Badge>
        )}
        {role && (
          <span className="text-dark-500 text-xs">({role})</span>
        )}
      </div>
      <div className="flex items-center gap-2">
        <ToolStatusBadge status={tool.status} />
        {tool.executionCount !== undefined && tool.executionCount > 0 && (
          <span className="text-dark-500 text-xs">
            {tool.executionCount} runs
          </span>
        )}
      </div>
    </div>
  );
}

function SkillSection({
  skill,
  expandedTools,
  isLoading,
  error,
}: {
  skill: Skill;
  expandedTools?: SkillToolExpanded[];
  isLoading?: boolean;
  error?: string;
}) {
  const [isExpanded, setIsExpanded] = useState(true);
  const safeTools = expandedTools || [];

  return (
    <div className="border border-dark-700 rounded-lg overflow-hidden">
      {/* Skill header */}
      <div
        className="flex items-center justify-between p-3 bg-dark-800 cursor-pointer hover:bg-dark-750 transition-colors"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center gap-2">
          {isExpanded ? (
            <ChevronDown className="w-4 h-4 text-dark-400" />
          ) : (
            <ChevronRight className="w-4 h-4 text-dark-400" />
          )}
          <Sparkles className="w-4 h-4 text-primary-400" />
          <span className="font-medium">{skill.name}</span>
          <Badge
            variant={skill.status === 'active' ? 'active' : 'inactive'}
            className="text-xs"
          >
            {skill.status}
          </Badge>
        </div>
        <div className="flex items-center gap-2 text-xs text-dark-500">
          {safeTools.length > 0 && (
            <span>{safeTools.length} tool{safeTools.length !== 1 ? 's' : ''}</span>
          )}
          {skill.version && <span>v{skill.version}</span>}
        </div>
      </div>

      {/* Expanded content */}
      {isExpanded && (
        <div className="p-3 space-y-2 bg-dark-850">
          {/* Description */}
          {skill.description && (
            <p className="text-dark-400 text-sm mb-3">{skill.description}</p>
          )}

          {/* Capabilities */}
          {skill.capabilities && skill.capabilities.length > 0 && (
            <div className="flex flex-wrap gap-1 mb-3">
              {skill.capabilities.map((cap, i) => (
                <Badge key={i} variant="default" className="text-xs">
                  {cap}
                </Badge>
              ))}
            </div>
          )}

          {/* Tools */}
          {isLoading ? (
            <div className="text-dark-500 text-sm py-2">Loading tools...</div>
          ) : error ? (
            <div className="flex items-center gap-2 text-red-400 text-sm py-2">
              <AlertCircle className="w-4 h-4" />
              {error}
            </div>
          ) : safeTools.length === 0 ? (
            <div className="text-dark-500 text-sm py-2 italic">
              No tools linked to this skill
            </div>
          ) : (
            <div className="space-y-1">
              {safeTools.map((link) => (
                <ToolRow
                  key={link.toolId}
                  tool={link.tool}
                  required={link.required}
                  role={link.role}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function AgentCapabilitiesPanel({
  skills,
  directTools,
  isLoading,
}: AgentCapabilitiesPanelProps) {
  const [skillsWithTools, setSkillsWithTools] = useState<SkillWithTools[]>([]);

  // Load tools for each skill
  useEffect(() => {
    if (!skills || skills.length === 0) {
      setSkillsWithTools([]);
      return;
    }

    // Initialize with loading state
    setSkillsWithTools(
      skills.map((s) => ({ ...s, toolsLoading: true }))
    );

    // Fetch tools for each skill
    skills.forEach(async (skill) => {
      try {
        const tools = await skillApi.getToolsExpanded(skill.id);
        setSkillsWithTools((prev) =>
          prev.map((s) =>
            s.id === skill.id
              ? { ...s, expandedTools: tools || [], toolsLoading: false }
              : s
          )
        );
      } catch (err) {
        setSkillsWithTools((prev) =>
          prev.map((s) =>
            s.id === skill.id
              ? {
                  ...s,
                  toolsLoading: false,
                  toolsError: err instanceof Error ? err.message : 'Failed to load tools',
                }
              : s
          )
        );
      }
    });
  }, [skills]);

  // Loading state
  if (isLoading) {
    return (
      <div className="animate-pulse space-y-3">
        <div className="h-16 bg-dark-700 rounded-lg" />
        <div className="h-16 bg-dark-700 rounded-lg" />
      </div>
    );
  }

  const safeSkills = skillsWithTools || [];
  const safeDirectTools = directTools || [];
  const hasContent = safeSkills.length > 0 || safeDirectTools.length > 0;

  if (!hasContent) {
    return (
      <div className="text-center py-8">
        <div className="flex justify-center gap-2 mb-3">
          <Sparkles className="w-6 h-6 text-dark-500" />
          <Wrench className="w-6 h-6 text-dark-500" />
        </div>
        <p className="text-dark-400">No skills or tools assigned</p>
        <p className="text-dark-500 text-sm mt-1">
          Assign skills to give this agent capabilities
        </p>
      </div>
    );
  }

  // Calculate totals
  const totalTools = safeSkills.reduce(
    (acc, s) => acc + (s.expandedTools?.length || 0),
    0
  ) + safeDirectTools.length;

  return (
    <div className="space-y-4">
      {/* Summary */}
      <div className="flex items-center gap-4 text-sm text-dark-400">
        <div className="flex items-center gap-1">
          <Sparkles className="w-4 h-4" />
          <span>{safeSkills.length} skill{safeSkills.length !== 1 ? 's' : ''}</span>
        </div>
        <div className="flex items-center gap-1">
          <Wrench className="w-4 h-4" />
          <span>{totalTools} tool{totalTools !== 1 ? 's' : ''}</span>
        </div>
      </div>

      {/* Skills with their tools */}
      {safeSkills.length > 0 && (
        <div className="space-y-3">
          <h4 className="text-sm font-medium text-dark-300 flex items-center gap-2">
            <Sparkles className="w-4 h-4 text-primary-400" />
            Skills
          </h4>
          {safeSkills.map((skill) => (
            <SkillSection
              key={skill.id}
              skill={skill}
              expandedTools={skill.expandedTools}
              isLoading={skill.toolsLoading}
              error={skill.toolsError}
            />
          ))}
        </div>
      )}

      {/* Direct tools (not via skill) */}
      {safeDirectTools.length > 0 && (
        <div className="space-y-2">
          <h4 className="text-sm font-medium text-dark-300 flex items-center gap-2">
            <Wrench className="w-4 h-4 text-cyan-400" />
            Direct Tools
          </h4>
          <div className="space-y-1">
            {safeDirectTools.map((tool) => (
              <ToolRow key={tool.id} tool={tool} />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
