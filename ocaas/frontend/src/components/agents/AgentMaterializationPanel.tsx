/**
 * AgentMaterializationPanel
 *
 * Shows the real materialization state of an agent.
 * Distinguishes between DB-only (activated) vs actually ready to execute.
 */

import {
  CheckCircle,
  XCircle,
  AlertTriangle,
  Database,
  Folder,
  FileCode,
  Play,
  Server,
} from 'lucide-react';
import { Badge } from '../ui';
import type { AgentMaterializationStatus, AgentLifecycleState } from '../../types';

interface AgentMaterializationPanelProps {
  status: AgentMaterializationStatus | null | undefined;
  isLoading?: boolean;
  error?: string | null;
}

// =============================================================================
// CONFIG
// =============================================================================

const stateConfig: Record<AgentLifecycleState, {
  label: string;
  description: string;
  variant: 'success' | 'pending' | 'error' | 'inactive';
  color: string;
}> = {
  record: {
    label: 'DB Only',
    description: 'Agent exists in database but is not materialized',
    variant: 'inactive',
    color: 'text-dark-400',
  },
  generated: {
    label: 'Generated',
    description: 'Generation exists but not yet activated',
    variant: 'pending',
    color: 'text-yellow-400',
  },
  activated: {
    label: 'Activated',
    description: 'Activated but workspace not prepared',
    variant: 'pending',
    color: 'text-yellow-400',
  },
  materialized: {
    label: 'Materialized',
    description: 'Workspace ready but NO runtime session',
    variant: 'pending',
    color: 'text-blue-400',
  },
  runtime_ready: {
    label: 'Runtime Ready',
    description: 'OpenClaw session active - ready to execute',
    variant: 'success',
    color: 'text-green-400',
  },
};

// =============================================================================
// SUB-COMPONENTS
// =============================================================================

function StatusIndicator({
  label,
  value,
  icon: Icon,
}: {
  label: string;
  value: boolean;
  icon: React.ElementType;
}) {
  return (
    <div className="flex items-center justify-between py-2 px-3 bg-dark-900 rounded">
      <div className="flex items-center gap-2">
        <Icon className={`w-4 h-4 ${value ? 'text-green-400' : 'text-dark-500'}`} />
        <span className="text-sm">{label}</span>
      </div>
      {value ? (
        <CheckCircle className="w-4 h-4 text-green-400" />
      ) : (
        <XCircle className="w-4 h-4 text-dark-500" />
      )}
    </div>
  );
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function AgentMaterializationPanel({
  status,
  isLoading,
  error,
}: AgentMaterializationPanelProps) {
  // Loading state
  if (isLoading) {
    return (
      <div className="animate-pulse space-y-3 p-4">
        <div className="h-12 bg-dark-700 rounded" />
        <div className="h-8 bg-dark-700 rounded" />
        <div className="h-8 bg-dark-700 rounded" />
      </div>
    );
  }

  // Error state
  if (error) {
    return (
      <div className="p-4">
        <div className="flex items-center gap-2 text-red-400">
          <AlertTriangle className="w-4 h-4" />
          <span className="text-sm">{error}</span>
        </div>
      </div>
    );
  }

  // No data state
  if (!status) {
    return (
      <div className="p-4 text-center">
        <AlertTriangle className="w-6 h-6 text-dark-500 mx-auto mb-2" />
        <p className="text-dark-400 text-sm">Materialization status not available</p>
      </div>
    );
  }

  const stateInfo = stateConfig[status.state] || stateConfig.record;
  const isReady = status.state === 'runtime_ready';
  const isPartial = status.state === 'materialized' || status.state === 'activated';

  return (
    <div className="space-y-4 p-4">
      {/* State Banner */}
      <div className={`p-4 rounded-lg border ${
        isReady
          ? 'bg-green-500/10 border-green-500/30'
          : isPartial
          ? 'bg-yellow-500/10 border-yellow-500/30'
          : 'bg-dark-800 border-dark-700'
      }`}>
        <div className="flex items-center justify-between">
          <div>
            <div className="flex items-center gap-2">
              <Badge variant={stateInfo.variant} className="text-sm">
                {stateInfo.label}
              </Badge>
              {isReady && (
                <span className="text-green-400 text-xs font-medium">Ready for execution</span>
              )}
              {isPartial && (
                <span className="text-yellow-400 text-xs font-medium">Partially materialized</span>
              )}
            </div>
            <p className="text-dark-400 text-sm mt-1">{stateInfo.description}</p>
          </div>
          {isReady ? (
            <Play className="w-8 h-8 text-green-400" />
          ) : isPartial ? (
            <AlertTriangle className="w-8 h-8 text-yellow-400" />
          ) : (
            <Database className="w-8 h-8 text-dark-500" />
          )}
        </div>
      </div>

      {/* Status Indicators */}
      <div className="space-y-1">
        <StatusIndicator
          label="DB Record"
          value={status.db_record}
          icon={Database}
        />
        <StatusIndicator
          label="Generation Active"
          value={status.generation_active}
          icon={FileCode}
        />
        <StatusIndicator
          label="Workspace Exists"
          value={status.workspace_exists}
          icon={Folder}
        />
        <StatusIndicator
          label="Config Written"
          value={status.config_written}
          icon={FileCode}
        />
        <StatusIndicator
          label="Runtime Possible"
          value={status.runtime_possible}
          icon={Play}
        />
        <StatusIndicator
          label="OpenClaw Session"
          value={status.openclaw_session}
          icon={Server}
        />
      </div>

      {/* Materialization result */}
      {status.materialization_attempted_at && (
        <div className="p-3 bg-dark-900 rounded">
          <div className="flex items-center justify-between text-sm">
            <span className="text-dark-400">Materialization</span>
            <Badge variant={status.materialization_succeeded ? 'success' : 'error'}>
              {status.materialization_succeeded ? 'Succeeded' : 'Failed'}
            </Badge>
          </div>
          {status.materialization_reason && (
            <p className="text-xs text-dark-500 mt-1">{status.materialization_reason}</p>
          )}
        </div>
      )}

      {/* Workspace path */}
      {status.target_workspace && (
        <div className="p-3 bg-dark-900 rounded">
          <p className="text-xs text-dark-400 mb-1">Workspace Path</p>
          <code className="text-xs text-dark-300 break-all">{status.target_workspace}</code>
        </div>
      )}

      {/* Gap warning for non-ready states */}
      {!isReady && status.db_record && (
        <div className="p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-yellow-400 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm text-yellow-400 font-medium">Not Ready for Execution</p>
              <p className="text-xs text-dark-400 mt-1">
                {status.state === 'activated' && 'Workspace not materialized. Agent cannot execute tasks.'}
                {status.state === 'materialized' && 'No OpenClaw session. Agent is materialized but not running.'}
                {status.state === 'record' && 'Agent exists in DB only. Needs activation and materialization.'}
                {status.state === 'generated' && 'Generation exists but not activated yet.'}
              </p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
