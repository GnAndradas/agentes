/**
 * GenerationResourceLink
 *
 * PROMPT 14: Enhanced to clearly show:
 * - Generation status vs Resource state
 * - Bundle partial warning
 * - Clear "not usable yet" messaging
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
  Clock,
  Ban,
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

/**
 * PROMPT 14: Check if this is from an incomplete bundle
 */
function extractBundleStatus(generation: Generation): {
  isBundle: boolean;
  bundleStatus: string | null;
  bundleId: string | null;
} {
  const meta = generation.metadata || {};
  const bundleId = (meta.bundleId as string) || null;
  const bundleStatus = (meta.bundleStatus as string) || null;

  return {
    isBundle: !!bundleId,
    bundleStatus,
    bundleId,
  };
}

/**
 * PROMPT 14: Determine if resource is actually usable
 */
function isResourceUsable(generation: Generation): { usable: boolean; reason?: string } {
  // Not active = not usable
  if (generation.status !== 'active') {
    return { usable: false, reason: 'Generation not activated' };
  }

  // Bundle partial = not usable
  const bundle = extractBundleStatus(generation);
  if (bundle.isBundle && bundle.bundleStatus !== 'complete') {
    return { usable: false, reason: 'Bundle incomplete' };
  }

  // No resource ID = might be usable but can't link
  const resourceId = extractResourceId(generation);
  if (!resourceId) {
    return { usable: true, reason: 'Resource ID not recorded' };
  }

  return { usable: true };
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function GenerationResourceLink({ generation }: GenerationResourceLinkProps) {
  const config = typeConfig[generation.type];
  const Icon = config.icon;
  const resourceId = extractResourceId(generation);
  const resourceStatus = extractResourceStatus(generation);
  const bundle = extractBundleStatus(generation);
  // Note: isResourceUsable available for future use
  void isResourceUsable; // Suppress unused warning

  // PROMPT 14: Bundle partial warning - show prominently
  if (bundle.isBundle && bundle.bundleStatus === 'partial') {
    return (
      <div className="p-4 bg-red-500/10 border border-red-500/30 rounded-lg">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-red-500/20 flex items-center justify-center">
            <Ban className="w-5 h-5 text-red-400" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <p className="text-sm text-red-400 font-medium">Bundle Incomplete</p>
              <Badge variant="error" className="text-xs">Not Usable</Badge>
            </div>
            <p className="text-xs text-red-300 mt-0.5">
              This {config.label.toLowerCase()} is part of an incomplete bundle and cannot be used for execution.
            </p>
          </div>
          <AlertTriangle className="w-5 h-5 text-red-400" />
        </div>
      </div>
    );
  }

  // PROMPT 14: Not activated yet - clearer messaging by status
  if (generation.status !== 'active') {
    // Determine specific message and styling
    let message: string;
    let subMessage: string;
    let StatusIcon: React.ElementType;
    let borderColor: string;
    let iconColor: string;

    switch (generation.status) {
      case 'rejected':
        message = 'Generation Rejected';
        subMessage = 'This generation was rejected and no resource was created';
        StatusIcon = XCircle;
        borderColor = 'border-red-500/30';
        iconColor = 'text-red-400';
        break;
      case 'failed':
        message = 'Generation Failed';
        subMessage = 'Generation process failed - no resource created';
        StatusIcon = XCircle;
        borderColor = 'border-red-500/30';
        iconColor = 'text-red-400';
        break;
      case 'pending_approval':
        message = 'Awaiting Approval';
        subMessage = 'Generation ready. Approve and activate to create the actual resource.';
        StatusIcon = Clock;
        borderColor = 'border-yellow-500/30';
        iconColor = 'text-yellow-400';
        break;
      case 'approved':
        // PROMPT 15: Clearer label
        message = 'Approved (Not Activated)';
        subMessage = 'Approved but not yet activated. Click Activate to create the resource.';
        StatusIcon = Clock;
        borderColor = 'border-blue-500/30';
        iconColor = 'text-blue-400';
        break;
      default:
        message = 'Resource Not Yet Created';
        subMessage = 'Complete the generation workflow to create the resource';
        StatusIcon = AlertTriangle;
        borderColor = 'border-dark-600';
        iconColor = 'text-dark-400';
    }

    return (
      <div className={`p-4 bg-dark-800 border ${borderColor} rounded-lg`}>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-lg bg-dark-700 flex items-center justify-center">
            <Icon className="w-5 h-5 text-dark-500" />
          </div>
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <p className="text-sm text-dark-300">{message}</p>
              <Badge variant="inactive" className="text-xs">No Resource</Badge>
            </div>
            <p className="text-xs text-dark-500 mt-0.5">{subMessage}</p>
          </div>
          <StatusIcon className={`w-5 h-5 ${iconColor}`} />
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

  // PROMPT 15: Check if ready for execution
  const isReadyForExecution = generation.status === 'active' && bundle.bundleStatus !== 'partial';

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
          <div className="flex items-center gap-2 flex-wrap">
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
            {/* PROMPT 15: Ready for Execution badge */}
            {isReadyForExecution && (
              <Badge variant="success" className="text-xs">
                <span className="mr-1">●</span>Ready
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
