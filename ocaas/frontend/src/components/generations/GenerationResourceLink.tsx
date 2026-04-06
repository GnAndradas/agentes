/**
 * GenerationResourceLink
 *
 * Links to the final activated resource (agent/skill/tool) if it exists.
 * Shows resource status and quick navigation.
 */

import { Link } from 'react-router-dom';
import {
  Bot,
  Sparkles,
  Wrench,
  ExternalLink,
  CheckCircle,
  XCircle,
  AlertTriangle,
} from 'lucide-react';
import { Badge } from '../ui';
import type { Generation, GenerationType } from '../../types';

interface GenerationResourceLinkProps {
  generation: Generation;
}

// =============================================================================
// CONFIG
// =============================================================================

const typeConfig: Record<GenerationType, {
  icon: React.ElementType;
  color: string;
  bgColor: string;
  route: string;
  label: string;
}> = {
  agent: {
    icon: Bot,
    color: 'text-primary-400',
    bgColor: 'bg-primary-500/10 border-primary-500/30',
    route: '/agents',
    label: 'Agent',
  },
  skill: {
    icon: Sparkles,
    color: 'text-purple-400',
    bgColor: 'bg-purple-500/10 border-purple-500/30',
    route: '/skills',
    label: 'Skill',
  },
  tool: {
    icon: Wrench,
    color: 'text-orange-400',
    bgColor: 'bg-orange-500/10 border-orange-500/30',
    route: '/tools',
    label: 'Tool',
  },
};

// =============================================================================
// HELPERS
// =============================================================================

function extractResourceId(generation: Generation): string | null {
  // Check metadata for resourceId
  const meta = generation.metadata || {};
  if (meta.resourceId) return meta.resourceId as string;
  if (meta.agentId) return meta.agentId as string;
  if (meta.skillId) return meta.skillId as string;
  if (meta.toolId) return meta.toolId as string;

  // Check generatedContent for id
  const content = generation.generatedContent || {};
  if (content.id) return content.id as string;

  return null;
}

function extractResourceStatus(generation: Generation): string | null {
  const meta = generation.metadata || {};
  return (meta.resourceStatus as string) || null;
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function GenerationResourceLink({ generation }: GenerationResourceLinkProps) {
  const config = typeConfig[generation.type];
  const Icon = config.icon;
  const resourceId = extractResourceId(generation);
  const resourceStatus = extractResourceStatus(generation);

  // Not activated yet
  if (generation.status !== 'active') {
    return (
      <div className="p-4 bg-dark-800 border border-dark-700 rounded-lg">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-dark-700 flex items-center justify-center">
            <Icon className="w-5 h-5 text-dark-500" />
          </div>
          <div className="flex-1">
            <p className="text-sm text-dark-400">Resource Not Created</p>
            <p className="text-xs text-dark-500 mt-0.5">
              {generation.status === 'rejected'
                ? 'This generation was rejected'
                : generation.status === 'failed'
                ? 'This generation failed'
                : 'Approve and activate to create the resource'}
            </p>
          </div>
          {generation.status === 'rejected' && (
            <XCircle className="w-5 h-5 text-red-400" />
          )}
          {generation.status === 'failed' && (
            <AlertTriangle className="w-5 h-5 text-red-400" />
          )}
          {generation.status !== 'rejected' && generation.status !== 'failed' && (
            <AlertTriangle className="w-5 h-5 text-yellow-400" />
          )}
        </div>
      </div>
    );
  }

  // Activated but no resource ID found
  if (!resourceId) {
    return (
      <div className={`p-4 border rounded-lg ${config.bgColor}`}>
        <div className="flex items-center gap-3">
          <div className={`w-10 h-10 rounded-lg bg-dark-800 flex items-center justify-center`}>
            <Icon className={`w-5 h-5 ${config.color}`} />
          </div>
          <div className="flex-1">
            <p className="text-sm">
              <span className={config.color}>{config.label}</span> Created
            </p>
            <p className="text-xs text-dark-400 mt-0.5">
              Resource ID not recorded in metadata
            </p>
          </div>
          <CheckCircle className="w-5 h-5 text-green-400" />
        </div>
      </div>
    );
  }

  // Have resource ID - show link
  const resourceUrl = `${config.route}/${resourceId}`;

  return (
    <Link
      to={resourceUrl}
      className={`block p-4 border rounded-lg transition-colors hover:bg-dark-700 ${config.bgColor}`}
    >
      <div className="flex items-center gap-3">
        <div className={`w-10 h-10 rounded-lg bg-dark-800 flex items-center justify-center`}>
          <Icon className={`w-5 h-5 ${config.color}`} />
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className="text-sm font-medium truncate">
              {generation.name}
            </p>
            {resourceStatus && (
              <Badge
                variant={
                  resourceStatus === 'active' ? 'active' :
                  resourceStatus === 'inactive' ? 'inactive' :
                  'default'
                }
                className="text-xs"
              >
                {resourceStatus}
              </Badge>
            )}
          </div>
          <p className="text-xs text-dark-400 mt-0.5">
            {config.label} ID: <span className="font-mono">{resourceId.slice(0, 8)}...</span>
          </p>
        </div>
        <div className="flex items-center gap-2">
          <CheckCircle className="w-4 h-4 text-green-400" />
          <ExternalLink className="w-4 h-4 text-dark-400" />
        </div>
      </div>
    </Link>
  );
}
