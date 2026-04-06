/**
 * GenerationOriginPanel
 *
 * Shows the origin/source of a generation - how it was created.
 * Displays available metadata about AI generation vs manual/fallback.
 */

import {
  Sparkles,
  User,
  AlertTriangle,
  Cpu,
  RefreshCw,
} from 'lucide-react';
import { Badge } from '../ui';
import type { Generation } from '../../types';

interface GenerationOriginPanelProps {
  generation: Generation;
}

type GeneratedBy = 'ai' | 'manual' | 'fallback' | 'heuristic' | 'unknown';

interface OriginMetadata {
  generated_by?: GeneratedBy;
  ai_attempted?: boolean;
  ai_succeeded?: boolean;
  fallback_used?: boolean;
  fallback_reason?: string;
  model?: string;
  provider?: string;
  temperature?: number;
  tokens_used?: number;
  generation_time_ms?: number;
}

// =============================================================================
// CONFIG
// =============================================================================

const originConfig: Record<GeneratedBy, {
  label: string;
  description: string;
  icon: React.ElementType;
  color: string;
  badgeVariant: 'success' | 'pending' | 'error' | 'inactive' | 'default';
}> = {
  ai: {
    label: 'AI Generated',
    description: 'Created using AI model inference',
    icon: Sparkles,
    color: 'text-primary-400',
    badgeVariant: 'success',
  },
  manual: {
    label: 'Manual',
    description: 'Created manually by a user',
    icon: User,
    color: 'text-blue-400',
    badgeVariant: 'default',
  },
  fallback: {
    label: 'Fallback',
    description: 'AI failed, used fallback generation',
    icon: AlertTriangle,
    color: 'text-yellow-400',
    badgeVariant: 'pending',
  },
  heuristic: {
    label: 'Heuristic',
    description: 'Generated using rule-based heuristics',
    icon: Cpu,
    color: 'text-orange-400',
    badgeVariant: 'pending',
  },
  unknown: {
    label: 'Unknown',
    description: 'Origin not recorded',
    icon: RefreshCw,
    color: 'text-dark-400',
    badgeVariant: 'inactive',
  },
};

// =============================================================================
// HELPER
// =============================================================================

function extractOriginMetadata(generation: Generation): OriginMetadata {
  const meta = generation.metadata || {};
  return {
    generated_by: meta.generated_by as GeneratedBy | undefined,
    ai_attempted: meta.ai_attempted as boolean | undefined,
    ai_succeeded: meta.ai_succeeded as boolean | undefined,
    fallback_used: meta.fallback_used as boolean | undefined,
    fallback_reason: meta.fallback_reason as string | undefined,
    model: meta.model as string | undefined,
    provider: meta.provider as string | undefined,
    temperature: meta.temperature as number | undefined,
    tokens_used: meta.tokens_used as number | undefined,
    generation_time_ms: meta.generation_time_ms as number | undefined,
  };
}

function determineOrigin(meta: OriginMetadata): GeneratedBy {
  // Explicit origin
  if (meta.generated_by) return meta.generated_by;

  // Infer from flags
  if (meta.fallback_used) return 'fallback';
  if (meta.ai_succeeded) return 'ai';
  if (meta.ai_attempted && !meta.ai_succeeded) return 'fallback';

  // Default
  return 'unknown';
}

// =============================================================================
// SUB-COMPONENTS
// =============================================================================

function MetadataRow({
  label,
  value,
}: {
  label: string;
  value: string | number | undefined;
}) {
  if (value === undefined || value === null) return null;

  return (
    <div className="flex items-center justify-between py-1.5 px-2 bg-dark-900 rounded">
      <span className="text-xs text-dark-400">{label}</span>
      <span className="text-xs font-mono">{value}</span>
    </div>
  );
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function GenerationOriginPanel({ generation }: GenerationOriginPanelProps) {
  const meta = extractOriginMetadata(generation);
  const origin = determineOrigin(meta);
  const config = originConfig[origin];
  const Icon = config.icon;

  // Check if we have any origin metadata at all
  const hasOriginData = meta.generated_by ||
                        meta.ai_attempted !== undefined ||
                        meta.fallback_used !== undefined ||
                        meta.model ||
                        meta.provider;

  return (
    <div className="space-y-3">
      {/* Origin Header */}
      <div className={`p-3 rounded-lg border ${
        origin === 'ai' ? 'bg-primary-500/10 border-primary-500/30' :
        origin === 'fallback' ? 'bg-yellow-500/10 border-yellow-500/30' :
        origin === 'manual' ? 'bg-blue-500/10 border-blue-500/30' :
        'bg-dark-800 border-dark-700'
      }`}>
        <div className="flex items-center gap-3">
          <Icon className={`w-5 h-5 ${config.color}`} />
          <div className="flex-1">
            <div className="flex items-center gap-2">
              <span className="font-medium text-sm">{config.label}</span>
              <Badge variant={config.badgeVariant} className="text-xs">
                {origin}
              </Badge>
            </div>
            <p className="text-xs text-dark-400 mt-0.5">{config.description}</p>
          </div>
        </div>
      </div>

      {/* AI Attempt Info */}
      {meta.ai_attempted !== undefined && (
        <div className="space-y-1">
          <div className="flex items-center justify-between py-1.5 px-2 bg-dark-900 rounded">
            <span className="text-xs text-dark-400">AI Attempted</span>
            <Badge variant={meta.ai_attempted ? 'success' : 'inactive'} className="text-xs">
              {meta.ai_attempted ? 'Yes' : 'No'}
            </Badge>
          </div>
          {meta.ai_attempted && meta.ai_succeeded !== undefined && (
            <div className="flex items-center justify-between py-1.5 px-2 bg-dark-900 rounded">
              <span className="text-xs text-dark-400">AI Succeeded</span>
              <Badge variant={meta.ai_succeeded ? 'success' : 'error'} className="text-xs">
                {meta.ai_succeeded ? 'Yes' : 'No'}
              </Badge>
            </div>
          )}
        </div>
      )}

      {/* Fallback Info */}
      {meta.fallback_used && (
        <div className="p-2 bg-yellow-500/10 border border-yellow-500/30 rounded">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-3 h-3 text-yellow-400 flex-shrink-0 mt-0.5" />
            <div>
              <span className="text-xs text-yellow-400 font-medium">Fallback Used</span>
              {meta.fallback_reason && (
                <p className="text-xs text-dark-400 mt-0.5">{meta.fallback_reason}</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* Model/Provider Info */}
      {(meta.model || meta.provider) && (
        <div className="space-y-1">
          <MetadataRow label="Model" value={meta.model} />
          <MetadataRow label="Provider" value={meta.provider} />
          <MetadataRow label="Temperature" value={meta.temperature} />
          <MetadataRow label="Tokens Used" value={meta.tokens_used} />
          {meta.generation_time_ms && (
            <MetadataRow label="Generation Time" value={`${meta.generation_time_ms}ms`} />
          )}
        </div>
      )}

      {/* No origin data available */}
      {!hasOriginData && (
        <p className="text-xs text-dark-500 text-center py-2">
          No origin metadata recorded for this generation
        </p>
      )}
    </div>
  );
}
