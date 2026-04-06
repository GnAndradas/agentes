/**
 * GenerationTracePanel
 *
 * P0-02: Shows REAL execution traceability.
 * Eliminates the "black box" problem by displaying:
 * - execution_mode (hooks_session | chat_completion | stub)
 * - AI status (requested, attempted, succeeded)
 * - fallback info
 * - raw/final output
 */

import {
  Cpu,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Clock,
  Zap,
  MessageSquare,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';
import { useState } from 'react';
import { Badge } from '../ui';
import type { ExecutionGenerationTrace, AIExecutionMode } from '../../types';

interface GenerationTracePanelProps {
  trace: ExecutionGenerationTrace | null | undefined;
  isLoading?: boolean;
}

// =============================================================================
// CONFIGURATION
// =============================================================================

/** Maps execution modes to UI config */
const modeConfig: Record<
  AIExecutionMode,
  { icon: React.ElementType; color: string; bg: string; label: string; description: string }
> = {
  hooks_session: {
    icon: Zap,
    color: 'text-green-400',
    bg: 'bg-green-500/10',
    label: 'Hooks Session',
    description: 'Stateful AI session via /hooks/agent (primary mode)',
  },
  chat_completion: {
    icon: MessageSquare,
    color: 'text-blue-400',
    bg: 'bg-blue-500/10',
    label: 'Chat Completion',
    description: 'Stateless AI call via /v1/chat/completions (fallback)',
  },
  stub: {
    icon: AlertTriangle,
    color: 'text-yellow-400',
    bg: 'bg-yellow-500/10',
    label: 'Stub',
    description: 'OpenClaw not configured - no real AI execution',
  },
  real_agent: {
    icon: Cpu,
    color: 'text-purple-400',
    bg: 'bg-purple-500/10',
    label: 'Real Agent',
    description: 'Full OpenClaw agent session (legacy)',
  },
};

// =============================================================================
// SUB-COMPONENTS
// =============================================================================

function StatusIndicator({
  label,
  value,
  success,
}: {
  label: string;
  value: boolean;
  success?: boolean;
}) {
  const color = value
    ? success !== false
      ? 'text-green-400'
      : 'text-red-400'
    : 'text-dark-500';
  const Icon = value ? (success !== false ? CheckCircle : XCircle) : XCircle;

  return (
    <div className="flex items-center gap-2">
      <Icon className={`w-4 h-4 ${color}`} />
      <span className="text-xs text-dark-400">{label}</span>
    </div>
  );
}

function OutputSection({
  title,
  content,
  maxHeight = '200px',
}: {
  title: string;
  content: string | undefined;
  maxHeight?: string;
}) {
  const [isExpanded, setIsExpanded] = useState(false);

  if (!content) {
    return (
      <div className="space-y-1">
        <p className="text-xs text-dark-500 font-medium">{title}</p>
        <p className="text-xs text-dark-600 italic">No output available</p>
      </div>
    );
  }

  const isLong = content.length > 500;
  const displayContent = isExpanded || !isLong ? content : content.slice(0, 500) + '...';

  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between">
        <p className="text-xs text-dark-500 font-medium">{title}</p>
        {isLong && (
          <button
            onClick={() => setIsExpanded(!isExpanded)}
            className="flex items-center gap-1 text-xs text-primary-400 hover:text-primary-300"
          >
            {isExpanded ? (
              <>
                <ChevronUp className="w-3 h-3" />
                Collapse
              </>
            ) : (
              <>
                <ChevronDown className="w-3 h-3" />
                Expand
              </>
            )}
          </button>
        )}
      </div>
      <pre
        className="text-xs bg-dark-900 p-3 rounded overflow-auto font-mono text-dark-300 whitespace-pre-wrap"
        style={{ maxHeight: isExpanded ? '600px' : maxHeight }}
      >
        {displayContent}
      </pre>
    </div>
  );
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function GenerationTracePanel({
  trace,
  isLoading,
}: GenerationTracePanelProps) {
  // Loading state
  if (isLoading) {
    return (
      <div className="animate-pulse space-y-3">
        <div className="h-12 bg-dark-700 rounded-lg" />
        <div className="h-8 bg-dark-700 rounded" />
        <div className="h-24 bg-dark-700 rounded" />
      </div>
    );
  }

  // No trace available
  if (!trace) {
    return (
      <div className="flex items-start gap-3 p-4 bg-dark-800 border border-dark-700 rounded-lg">
        <Clock className="w-5 h-5 text-dark-400 flex-shrink-0 mt-0.5" />
        <div>
          <p className="text-sm font-medium text-dark-300">Generation trace not available</p>
          <p className="text-xs text-dark-500 mt-1">
            This task has not been executed yet, or the trace is not available.
          </p>
        </div>
      </div>
    );
  }

  const mode = modeConfig[trace.executionMode] || modeConfig.stub;
  const ModeIcon = mode.icon;

  // Overall success indicator
  const isSuccess = trace.aiSucceeded;
  const isFallback = trace.fallbackUsed;

  return (
    <div className="space-y-4">
      {/* Execution mode banner */}
      <div className={`flex items-start gap-3 p-4 rounded-lg border ${mode.bg} border-dark-700`}>
        <ModeIcon className={`w-5 h-5 ${mode.color} flex-shrink-0 mt-0.5`} />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <p className={`text-sm font-medium ${mode.color}`}>{mode.label}</p>
            {isSuccess && <Badge variant="success" className="text-xs">Success</Badge>}
            {!isSuccess && trace.aiAttempted && <Badge variant="error" className="text-xs">Failed</Badge>}
            {isFallback && <Badge variant="pending" className="text-xs">Fallback</Badge>}
          </div>
          <p className="text-xs text-dark-400 mt-1">{mode.description}</p>
        </div>
      </div>

      {/* AI Status indicators */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <StatusIndicator label="AI Requested" value={trace.aiRequested} />
        <StatusIndicator label="AI Attempted" value={trace.aiAttempted} />
        <StatusIndicator label="AI Succeeded" value={trace.aiSucceeded} success={true} />
        <StatusIndicator label="Fallback Used" value={trace.fallbackUsed} success={false} />
      </div>

      {/* Fallback reason */}
      {trace.fallbackUsed && trace.fallbackReason && (
        <div className="flex items-start gap-2 p-3 bg-yellow-500/10 border border-yellow-500/30 rounded-lg">
          <AlertTriangle className="w-4 h-4 text-yellow-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-xs text-yellow-400 font-medium">Fallback reason</p>
            <p className="text-xs text-yellow-300/80 mt-0.5">{trace.fallbackReason}</p>
          </div>
        </div>
      )}

      {/* Error message */}
      {trace.error && (
        <div className="flex items-start gap-2 p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
          <XCircle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-xs text-red-400 font-medium">Error</p>
            <p className="text-xs text-red-300/80 mt-0.5">{trace.error}</p>
          </div>
        </div>
      )}

      {/* Raw output (from AI) */}
      <OutputSection title="Raw AI Output" content={trace.rawOutput} />

      {/* Final output (processed) */}
      <OutputSection title="Final Output" content={trace.finalOutput} />

      {/* Metadata footer */}
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-dark-600 pt-2 border-t border-dark-700">
        {trace.model && (
          <span>
            Model: <span className="text-dark-400">{trace.model}</span>
          </span>
        )}
        {trace.tokenUsage && (
          <span>
            Tokens: <span className="text-dark-400">{trace.tokenUsage.input} in / {trace.tokenUsage.output} out</span>
          </span>
        )}
        {trace.durationMs !== undefined && (
          <span>
            Duration: <span className="text-dark-400">{trace.durationMs}ms</span>
          </span>
        )}
        <span>
          Created: <span className="text-dark-400">{new Date(trace.createdAt).toLocaleString()}</span>
        </span>
      </div>
    </div>
  );
}
