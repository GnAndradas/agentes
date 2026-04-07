/**
 * GenerationLifecyclePanel
 *
 * Shows the lifecycle progression and validation status of a generation.
 * Visualizes the status flow and validation results.
 */

import {
  CheckCircle,
  XCircle,
  Clock,
  AlertTriangle,
  ArrowRight,
  FileCheck,
  User,
  Play,
} from 'lucide-react';
import { Badge } from '../ui';
import type { Generation, GenerationStatus } from '../../types';
import { fromTimestamp } from '../../lib/date';

interface GenerationLifecyclePanelProps {
  generation: Generation;
}

// =============================================================================
// CONFIG
// =============================================================================

const statusFlow: GenerationStatus[] = [
  'draft',
  'generated',
  'pending_approval',
  'approved',
  'active',
];

const statusConfig: Record<GenerationStatus, {
  label: string;
  icon: React.ElementType;
  color: string;
  bgColor: string;
}> = {
  draft: {
    label: 'Draft',
    icon: Clock,
    color: 'text-dark-400',
    bgColor: 'bg-dark-700',
  },
  generated: {
    label: 'Generated',
    icon: FileCheck,
    color: 'text-blue-400',
    bgColor: 'bg-blue-500/20',
  },
  pending_approval: {
    label: 'Pending Approval',
    icon: Clock,
    color: 'text-yellow-400',
    bgColor: 'bg-yellow-500/20',
  },
  approved: {
    label: 'Approved',
    icon: CheckCircle,
    color: 'text-green-400',
    bgColor: 'bg-green-500/20',
  },
  rejected: {
    label: 'Rejected',
    icon: XCircle,
    color: 'text-red-400',
    bgColor: 'bg-red-500/20',
  },
  active: {
    label: 'Active',
    icon: Play,
    color: 'text-green-400',
    bgColor: 'bg-green-500/20',
  },
  failed: {
    label: 'Failed',
    icon: XCircle,
    color: 'text-red-400',
    bgColor: 'bg-red-500/20',
  },
};

// =============================================================================
// SUB-COMPONENTS
// =============================================================================

function StatusStep({
  status,
  currentStatus,
  isTerminal = false,
}: {
  status: GenerationStatus;
  currentStatus: GenerationStatus;
  isTerminal?: boolean;
}) {
  const config = statusConfig[status];
  const Icon = config.icon;

  const currentIndex = statusFlow.indexOf(currentStatus);
  const stepIndex = statusFlow.indexOf(status);

  // Handle terminal states (rejected, failed)
  const isRejectedOrFailed = currentStatus === 'rejected' || currentStatus === 'failed';
  const isPast = !isRejectedOrFailed && currentIndex > stepIndex;
  const isCurrent = currentStatus === status;

  return (
    <div className="flex items-center gap-2">
      <div className={`w-6 h-6 rounded-full flex items-center justify-center ${
        isPast || isCurrent ? config.bgColor : 'bg-dark-800'
      }`}>
        <Icon className={`w-3 h-3 ${
          isPast || isCurrent ? config.color : 'text-dark-500'
        }`} />
      </div>
      <span className={`text-xs ${
        isCurrent ? config.color + ' font-medium' :
        isPast ? 'text-dark-300' : 'text-dark-500'
      }`}>
        {config.label}
      </span>
      {!isTerminal && (
        <ArrowRight className="w-3 h-3 text-dark-600 ml-auto" />
      )}
    </div>
  );
}

function ValidationResultView({ validation }: { validation: Record<string, unknown> }) {
  const isValid = validation.valid === true;
  const score = typeof validation.score === 'number' ? validation.score : null;
  const issues = Array.isArray(validation.issues) ? validation.issues : [];
  const suggestions = Array.isArray(validation.suggestions) ? validation.suggestions : [];

  return (
    <div className="space-y-3">
      {/* Overall result */}
      <div className={`p-3 rounded-lg border ${
        isValid
          ? 'bg-green-500/10 border-green-500/30'
          : 'bg-red-500/10 border-red-500/30'
      }`}>
        <div className="flex items-center gap-2">
          {isValid ? (
            <CheckCircle className="w-4 h-4 text-green-400" />
          ) : (
            <XCircle className="w-4 h-4 text-red-400" />
          )}
          <span className={`text-sm font-medium ${isValid ? 'text-green-400' : 'text-red-400'}`}>
            {isValid ? 'Validation Passed' : 'Validation Failed'}
          </span>
          {score !== null && (
            <Badge variant={score >= 0.8 ? 'success' : score >= 0.5 ? 'pending' : 'error'} className="ml-auto text-xs">
              Score: {(score * 100).toFixed(0)}%
            </Badge>
          )}
        </div>
      </div>

      {/* Issues */}
      {issues.length > 0 && (
        <div className="space-y-1">
          <span className="text-xs text-dark-400">Issues</span>
          {issues.map((issue, i) => {
            const issueObj = issue as { field?: string; message?: string; severity?: string };
            return (
              <div key={i} className="flex items-start gap-2 p-2 bg-dark-900 rounded text-xs">
                <AlertTriangle className={`w-3 h-3 flex-shrink-0 mt-0.5 ${
                  issueObj.severity === 'error' ? 'text-red-400' :
                  issueObj.severity === 'warning' ? 'text-yellow-400' :
                  'text-blue-400'
                }`} />
                <div>
                  {issueObj.field && (
                    <span className="font-mono text-dark-300">{issueObj.field}: </span>
                  )}
                  <span className="text-dark-400">{issueObj.message || String(issue)}</span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Suggestions */}
      {suggestions.length > 0 && (
        <div className="space-y-1">
          <span className="text-xs text-dark-400">Suggestions</span>
          {suggestions.map((suggestion, i) => (
            <div key={i} className="p-2 bg-dark-900 rounded text-xs text-dark-400">
              {String(suggestion)}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function TimelineEvent({
  label,
  timestamp,
  actor,
  icon: Icon,
}: {
  label: string;
  timestamp: number | undefined;
  actor?: string;
  icon: React.ElementType;
}) {
  if (!timestamp) return null;

  const date = fromTimestamp(timestamp);
  const formatted = date ? date.toLocaleString() : '-';

  return (
    <div className="flex items-start gap-3 py-2">
      <div className="w-6 h-6 rounded-full bg-dark-800 flex items-center justify-center flex-shrink-0">
        <Icon className="w-3 h-3 text-dark-400" />
      </div>
      <div className="flex-1 min-w-0">
        <div className="flex items-center justify-between">
          <span className="text-sm">{label}</span>
          <span className="text-xs text-dark-500">{formatted}</span>
        </div>
        {actor && (
          <div className="flex items-center gap-1 mt-0.5">
            <User className="w-3 h-3 text-dark-500" />
            <span className="text-xs text-dark-500">{actor}</span>
          </div>
        )}
      </div>
    </div>
  );
}

// =============================================================================
// MAIN COMPONENT
// =============================================================================

export function GenerationLifecyclePanel({ generation }: GenerationLifecyclePanelProps) {
  const isRejectedOrFailed = generation.status === 'rejected' || generation.status === 'failed';

  return (
    <div className="space-y-4">
      {/* Status Progress */}
      <div className="p-3 bg-dark-900 rounded-lg">
        <span className="text-xs text-dark-400 block mb-3">Status Progression</span>
        <div className="space-y-2">
          {isRejectedOrFailed ? (
            // Show truncated flow for rejected/failed
            <>
              <StatusStep status="draft" currentStatus={generation.status} />
              <StatusStep status="generated" currentStatus={generation.status} />
              <StatusStep status="pending_approval" currentStatus={generation.status} />
              <div className="flex items-center gap-2">
                <div className={`w-6 h-6 rounded-full flex items-center justify-center ${
                  statusConfig[generation.status].bgColor
                }`}>
                  <XCircle className={`w-3 h-3 ${statusConfig[generation.status].color}`} />
                </div>
                <span className={`text-xs ${statusConfig[generation.status].color} font-medium`}>
                  {statusConfig[generation.status].label}
                </span>
              </div>
            </>
          ) : (
            // Show normal flow
            statusFlow.map((status, i) => (
              <StatusStep
                key={status}
                status={status}
                currentStatus={generation.status}
                isTerminal={i === statusFlow.length - 1}
              />
            ))
          )}
        </div>
      </div>

      {/* PROMPT 14 + 15: Current Status Badge with clear labels */}
      <div className="space-y-2">
        {/* Generation Status */}
        <div className="flex items-center justify-between p-3 bg-dark-800 rounded-lg">
          <span className="text-sm text-dark-400">Generation Status</span>
          <Badge
            variant={
              generation.status === 'active' || generation.status === 'approved' ? 'success' :
              generation.status === 'rejected' || generation.status === 'failed' ? 'error' :
              generation.status === 'pending_approval' || generation.status === 'generated' ? 'pending' :
              'inactive'
            }
          >
            {generation.status.replace('_', ' ')}
          </Badge>
        </div>

        {/* PROMPT 15: Resource Status - separate from generation */}
        <div className="flex items-center justify-between p-3 bg-dark-800 rounded-lg">
          <span className="text-sm text-dark-400">Resource State</span>
          {generation.status === 'active' ? (
            <Badge variant="active">Active</Badge>
          ) : generation.status === 'approved' ? (
            <Badge variant="pending">Approved (Not Activated)</Badge>
          ) : generation.status === 'rejected' || generation.status === 'failed' ? (
            <Badge variant="error">Not Created</Badge>
          ) : (
            <Badge variant="inactive">Not Created</Badge>
          )}
        </div>

        {/* PROMPT 15: Ready for Execution indicator */}
        {(() => {
          const meta = generation.metadata || {};
          const isBundle = !!meta.bundleId;
          const bundlePartial = meta.bundleStatus === 'partial';

          if (generation.status === 'active' && !bundlePartial) {
            return (
              <div className="p-2 bg-green-500/10 border border-green-500/30 rounded">
                <div className="flex items-center gap-2">
                  <span className="text-green-400">●</span>
                  <span className="text-xs text-green-400 font-medium">Ready for Execution</span>
                </div>
              </div>
            );
          }

          if (isBundle && bundlePartial) {
            return (
              <div className="p-2 bg-red-500/10 border border-red-500/30 rounded">
                <div className="flex items-center gap-2">
                  <span className="text-red-400">●</span>
                  <span className="text-xs text-red-400 font-medium">Not Usable (Bundle Incomplete)</span>
                </div>
              </div>
            );
          }

          // Not active yet
          if (generation.status !== 'active') {
            return (
              <div className="p-2 bg-dark-900 border border-dark-700 rounded">
                <p className="text-xs text-dark-400">
                  {generation.status === 'pending_approval' && (
                    <>Resource will be created after approval and activation.</>
                  )}
                  {generation.status === 'approved' && (
                    <>Resource will be created when activated.</>
                  )}
                  {generation.status === 'generated' && (
                    <>Awaiting review. Approve to proceed.</>
                  )}
                  {(generation.status === 'rejected' || generation.status === 'failed') && (
                    <>This generation cannot create a resource.</>
                  )}
                  {generation.status === 'draft' && (
                    <>Generation in progress.</>
                  )}
                </p>
              </div>
            );
          }

          return null;
        })()}
      </div>

      {/* Validation Result */}
      {generation.validationResult && (
        <div>
          <span className="text-xs text-dark-400 block mb-2">Validation</span>
          <ValidationResultView validation={generation.validationResult} />
        </div>
      )}

      {/* Timeline */}
      <div className="border-l-2 border-dark-700 pl-2">
        <span className="text-xs text-dark-400 block mb-2">Timeline</span>
        <TimelineEvent
          label="Created"
          timestamp={generation.createdAt}
          icon={Clock}
        />
        <TimelineEvent
          label="Approved"
          timestamp={generation.approvedAt}
          actor={generation.approvedBy}
          icon={CheckCircle}
        />
        <TimelineEvent
          label="Activated"
          timestamp={generation.activatedAt}
          icon={Play}
        />
      </div>

      {/* Error Message */}
      {generation.errorMessage && (
        <div className="p-3 bg-red-500/10 border border-red-500/30 rounded-lg">
          <div className="flex items-start gap-2">
            <AlertTriangle className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
            <div>
              <span className="text-sm text-red-400 font-medium">Error</span>
              <p className="text-xs text-red-300 mt-1">{generation.errorMessage}</p>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
