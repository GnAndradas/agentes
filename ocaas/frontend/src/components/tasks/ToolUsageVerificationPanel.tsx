/**
 * ToolUsageVerificationPanel
 *
 * Displays the result of the 7-phase tool usage verification protocol.
 * Shows whether a task actually executed tools using only verifiable evidence.
 *
 * Result interpretation:
 * - true: Explicit evidence of tool execution (green checkmark)
 * - false: Explicit evidence of NO tool execution (red X)
 * - 'unknown': No contractual confirmation available (gray question mark)
 */

import { useState, useEffect } from 'react';
import {
  CheckCircle,
  XCircle,
  HelpCircle,
  Wrench,
  AlertTriangle,
  ChevronDown,
  ChevronRight,
  Shield,
  FileText,
  Server,
  Clock,
  Layers,
} from 'lucide-react';
import { Badge } from '../ui';
import { taskApi } from '../../lib/api';
import type { ToolUsageVerificationResult, ToolUsageVerificationPhase } from '../../types';

interface ToolUsageVerificationPanelProps {
  taskId: string;
  refreshInterval?: number;
}

// Phase icons
const phaseIcons: Record<string, React.ElementType> = {
  IDENTIFY_TASK: FileText,
  RUNTIME_EVENTS: Server,
  CONTRACTUAL_RESOURCE_CHECK: Shield,
  DEBUG_SUMMARY: AlertTriangle,
  EXECUTION_TIMELINE: Clock,
  FINAL_RESULT: Wrench,
  VALIDATION: CheckCircle,
};

// Phase status colors
const statusColors: Record<string, string> = {
  pass: 'text-green-400',
  fail: 'text-red-400',
  skip: 'text-dark-500',
  inconclusive: 'text-yellow-400',
};

const statusBgColors: Record<string, string> = {
  pass: 'bg-green-900/20',
  fail: 'bg-red-900/20',
  skip: 'bg-dark-800',
  inconclusive: 'bg-yellow-900/20',
};

function PhaseRow({
  phase,
  isExpanded,
  onToggle,
}: {
  phase: ToolUsageVerificationPhase;
  isExpanded: boolean;
  onToggle: () => void;
}) {
  const Icon = phaseIcons[phase.name] || FileText;
  const hasData = phase.data && Object.keys(phase.data).length > 0;

  return (
    <div className="border-b border-dark-800 last:border-b-0">
      <div
        className={`flex items-start gap-2 p-2 ${hasData ? 'cursor-pointer hover:bg-dark-800/50' : ''}`}
        onClick={hasData ? onToggle : undefined}
      >
        {/* Expand icon */}
        <div className="w-4 pt-0.5 flex-shrink-0">
          {hasData && (
            isExpanded ? (
              <ChevronDown className="w-3 h-3 text-dark-500" />
            ) : (
              <ChevronRight className="w-3 h-3 text-dark-500" />
            )
          )}
        </div>

        {/* Phase number */}
        <span className="text-[10px] text-dark-500 font-mono w-6 flex-shrink-0 pt-0.5">
          #{phase.phase}
        </span>

        {/* Phase icon and name */}
        <div className={`flex items-center gap-1 px-1.5 py-0.5 rounded ${statusBgColors[phase.status]} flex-shrink-0`}>
          <Icon className={`w-3 h-3 ${statusColors[phase.status]}`} />
          <span className={`text-[9px] font-medium ${statusColors[phase.status]}`}>
            {phase.name.replace(/_/g, ' ')}
          </span>
        </div>

        {/* Status badge */}
        <Badge
          variant={phase.status === 'pass' ? 'active' : phase.status === 'fail' ? 'error' : 'default'}
          className="text-[8px] py-0 px-1"
        >
          {phase.status}
        </Badge>

        {/* Evidence (truncated) */}
        {phase.evidence && (
          <span className="text-[10px] text-dark-400 truncate flex-1" title={phase.evidence}>
            {phase.evidence}
          </span>
        )}
      </div>

      {/* Expanded data */}
      {isExpanded && hasData && (
        <div className="px-8 pb-2">
          <pre className="text-[9px] text-dark-500 bg-dark-950 p-2 rounded overflow-x-auto max-h-32">
            {JSON.stringify(phase.data, null, 2)}
          </pre>
        </div>
      )}
    </div>
  );
}

export function ToolUsageVerificationPanel({
  taskId,
  refreshInterval = 0,
}: ToolUsageVerificationPanelProps) {
  const [data, setData] = useState<ToolUsageVerificationResult | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [expandedPhases, setExpandedPhases] = useState<Set<number>>(new Set());

  const fetchVerification = async () => {
    try {
      const result = await taskApi.getToolUsageVerification(taskId);
      setData(result);
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to fetch verification');
    } finally {
      setIsLoading(false);
    }
  };

  useEffect(() => {
    fetchVerification();

    if (refreshInterval > 0) {
      const interval = setInterval(fetchVerification, refreshInterval);
      return () => clearInterval(interval);
    }
  }, [taskId, refreshInterval]);

  const togglePhase = (phaseNum: number) => {
    setExpandedPhases(prev => {
      const next = new Set(prev);
      if (next.has(phaseNum)) {
        next.delete(phaseNum);
      } else {
        next.add(phaseNum);
      }
      return next;
    });
  };

  if (isLoading) {
    return (
      <div className="animate-pulse space-y-2 p-4">
        <div className="h-4 bg-dark-700 rounded w-1/3" />
        <div className="h-24 bg-dark-700 rounded" />
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex items-center gap-2 p-3 bg-red-900/20 border border-red-800/50 rounded-lg m-4">
        <AlertTriangle className="w-4 h-4 text-red-400" />
        <p className="text-xs text-red-400">{error}</p>
      </div>
    );
  }

  if (!data) {
    return (
      <div className="text-center py-6 text-dark-500 text-sm">
        <Wrench className="w-5 h-5 mx-auto mb-2 opacity-50" />
        No verification data
      </div>
    );
  }

  // Determine result display
  const getResultDisplay = () => {
    if (data.tools_used === true) {
      return {
        icon: CheckCircle,
        color: 'text-green-400',
        bgColor: 'bg-green-900/30',
        label: 'Tools Used',
        sublabel: `${data.confirmed_tools?.length || 0} tool(s) confirmed`,
      };
    }
    if (data.tools_used === false) {
      return {
        icon: XCircle,
        color: 'text-red-400',
        bgColor: 'bg-red-900/30',
        label: 'No Tools Used',
        sublabel: 'Verified: no tool execution',
      };
    }
    return {
      icon: HelpCircle,
      color: 'text-dark-400',
      bgColor: 'bg-dark-800',
      label: 'Unknown',
      sublabel: 'No contractual confirmation',
    };
  };

  const result = getResultDisplay();
  const ResultIcon = result.icon;

  return (
    <div className="space-y-3 p-4">
      {/* Header with result */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2 text-sm font-medium text-dark-200">
          <Wrench className="w-4 h-4 text-primary-400" />
          Tool Usage Verification
        </div>
        <div className={`flex items-center gap-2 px-2 py-1 rounded ${result.bgColor}`}>
          <ResultIcon className={`w-4 h-4 ${result.color}`} />
          <div className="text-right">
            <span className={`text-xs font-medium ${result.color}`}>{result.label}</span>
            <p className="text-[9px] text-dark-500">{result.sublabel}</p>
          </div>
        </div>
      </div>

      {/* Tool Policy Status - NEW */}
      <div className="grid grid-cols-2 gap-2">
        {/* Policy */}
        <div className="flex items-center gap-2 p-2 bg-dark-900 rounded">
          <Shield className={`w-3.5 h-3.5 flex-shrink-0 ${data.tool_policy === 'tool_first' ? 'text-cyan-400' : 'text-dark-500'}`} />
          <div className="flex-1 min-w-0">
            <p className="text-[10px] text-dark-500">Policy</p>
            <p className={`text-xs truncate ${data.tool_policy === 'tool_first' ? 'text-cyan-400' : 'text-dark-400'}`}>
              {data.tool_policy === 'tool_first' ? 'Tool-First' : 'Standard'}
            </p>
          </div>
        </div>

        {/* Tools Available */}
        <div className="flex items-center gap-2 p-2 bg-dark-900 rounded">
          <Wrench className={`w-3.5 h-3.5 flex-shrink-0 ${data.tools_available ? 'text-green-400' : 'text-dark-500'}`} />
          <div className="flex-1 min-w-0">
            <p className="text-[10px] text-dark-500">Tools Available</p>
            <p className={`text-xs ${data.tools_available ? 'text-green-400' : 'text-dark-400'}`}>
              {data.tools_available ? 'Yes' : 'No'}
            </p>
          </div>
        </div>

        {/* Tool Attempted */}
        <div className="flex items-center gap-2 p-2 bg-dark-900 rounded">
          {data.tool_attempted === true ? (
            <CheckCircle className="w-3.5 h-3.5 flex-shrink-0 text-green-400" />
          ) : data.tool_attempted === false ? (
            <XCircle className="w-3.5 h-3.5 flex-shrink-0 text-red-400" />
          ) : (
            <HelpCircle className="w-3.5 h-3.5 flex-shrink-0 text-dark-500" />
          )}
          <div className="flex-1 min-w-0">
            <p className="text-[10px] text-dark-500">Tool Attempted</p>
            <p className={`text-xs ${
              data.tool_attempted === true ? 'text-green-400' :
              data.tool_attempted === false ? 'text-red-400' : 'text-dark-400'
            }`}>
              {data.tool_attempted === true ? 'Yes' : data.tool_attempted === false ? 'No' : 'Unknown'}
            </p>
          </div>
        </div>

        {/* Tool Used Verified */}
        <div className="flex items-center gap-2 p-2 bg-dark-900 rounded">
          {data.tools_used === true ? (
            <CheckCircle className="w-3.5 h-3.5 flex-shrink-0 text-green-400" />
          ) : data.tools_used === false ? (
            <XCircle className="w-3.5 h-3.5 flex-shrink-0 text-red-400" />
          ) : (
            <HelpCircle className="w-3.5 h-3.5 flex-shrink-0 text-dark-500" />
          )}
          <div className="flex-1 min-w-0">
            <p className="text-[10px] text-dark-500">Tool Used (Verified)</p>
            <p className={`text-xs ${
              data.tools_used === true ? 'text-green-400' :
              data.tools_used === false ? 'text-red-400' : 'text-dark-400'
            }`}>
              {data.tools_used === true ? 'Yes' : data.tools_used === false ? 'No' : 'Unknown'}
            </p>
          </div>
        </div>
      </div>

      {/* Warning if tool_first but no attempt */}
      {data.tool_policy === 'tool_first' && data.tool_attempted === false && (
        <div className="flex items-start gap-2 p-2 bg-yellow-900/20 border border-yellow-800/30 rounded-lg">
          <AlertTriangle className="w-3 h-3 text-yellow-400 mt-0.5 flex-shrink-0" />
          <div className="text-[10px] text-yellow-400/80">
            <span className="font-medium">Tool-first policy active but no tool attempt detected.</span>
            {data.tool_not_attempted_reason && (
              <span className="block mt-0.5">{data.tool_not_attempted_reason}</span>
            )}
          </div>
        </div>
      )}

      {/* Enforcement Status (if active) */}
      {data.tool_enforced && (
        <div className="p-2 bg-dark-900 rounded-lg">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Shield className="w-3 h-3 text-purple-400" />
              <span className="text-[10px] text-dark-500 uppercase tracking-wider">Enforcement</span>
            </div>
            <Badge
              variant={
                data.enforcement_result === 'success' ? 'active' :
                data.enforcement_result === 'failed' ? 'error' : 'default'
              }
              className="text-[8px] py-0 px-1"
            >
              {data.enforcement_result || 'unknown'}
            </Badge>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {/* Enforcement Active */}
            <div className="flex items-center gap-1.5">
              <CheckCircle className="w-3 h-3 text-purple-400" />
              <span className="text-[10px] text-dark-400">Active</span>
            </div>

            {/* Triggered */}
            <div className="flex items-center gap-1.5">
              {data.tool_enforcement_triggered ? (
                <AlertTriangle className="w-3 h-3 text-yellow-400" />
              ) : (
                <CheckCircle className="w-3 h-3 text-green-400" />
              )}
              <span className={`text-[10px] ${data.tool_enforcement_triggered ? 'text-yellow-400' : 'text-dark-400'}`}>
                {data.tool_enforcement_triggered ? 'Triggered' : 'Not triggered'}
              </span>
            </div>

            {/* Attempts */}
            {typeof data.enforcement_attempts === 'number' && (
              <div className="flex items-center gap-1.5 col-span-2">
                <span className="text-[10px] text-dark-500">Retries:</span>
                <span className={`text-[10px] font-mono ${
                  data.enforcement_attempts > 0 ? 'text-yellow-400' : 'text-green-400'
                }`}>
                  {data.enforcement_attempts}
                </span>
              </div>
            )}
          </div>

          {/* Enforcement failed warning */}
          {data.enforcement_result === 'failed' && (
            <div className="flex items-start gap-2 mt-2 p-1.5 bg-red-900/20 border border-red-800/30 rounded">
              <XCircle className="w-3 h-3 text-red-400 mt-0.5 flex-shrink-0" />
              <span className="text-[9px] text-red-400/80">
                Enforcement failed after {data.enforcement_attempts || 0} retries. Model did not use available tools.
              </span>
            </div>
          )}
        </div>
      )}

      {/* ATR Loop Status (Autonomous Task Resolution) */}
      {typeof data.resolution_attempts === 'number' && data.resolution_attempts > 0 && (
        <div className="p-2 bg-dark-900 rounded-lg">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Clock className="w-3 h-3 text-blue-400" />
              <span className="text-[10px] text-dark-500 uppercase tracking-wider">ATR Loop</span>
            </div>
            <Badge
              variant={
                data.final_resolution_status === 'success' ? 'active' :
                data.final_resolution_status === 'failed' ? 'error' : 'default'
              }
              className="text-[8px] py-0 px-1"
            >
              {data.final_resolution_status || 'unknown'}
            </Badge>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {/* Attempts */}
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-dark-500">Attempts:</span>
              <span className={`text-[10px] font-mono ${
                data.resolution_attempts > 0 ? 'text-blue-400' : 'text-dark-400'
              }`}>
                {data.resolution_attempts}
              </span>
            </div>

            {/* Human Required */}
            <div className="flex items-center gap-1.5">
              {data.requires_human_intervention ? (
                <AlertTriangle className="w-3 h-3 text-orange-400" />
              ) : (
                <CheckCircle className="w-3 h-3 text-green-400" />
              )}
              <span className={`text-[10px] ${
                data.requires_human_intervention ? 'text-orange-400' : 'text-dark-400'
              }`}>
                {data.requires_human_intervention ? 'Human Required' : 'Auto-resolved'}
              </span>
            </div>
          </div>

          {/* Resolution path */}
          {Array.isArray(data.resolution_path) && data.resolution_path.length > 0 && (
            <div className="mt-2 pt-2 border-t border-dark-800">
              <span className="text-[9px] text-dark-500 uppercase">Resolution Path</span>
              <div className="flex flex-wrap gap-1 mt-1">
                {data.resolution_path.map((entry, idx) => (
                  <Badge
                    key={idx}
                    variant={entry.action === 'accept' ? 'active' : entry.action === 'escalate' ? 'error' : 'default'}
                    className="text-[8px] py-0 px-1"
                  >
                    #{entry.attempt}: {entry.reason} → {entry.action}
                  </Badge>
                ))}
              </div>
            </div>
          )}

          {/* Human escalation reason */}
          {data.requires_human_intervention && data.human_escalation_reason && (
            <div className="flex items-start gap-2 mt-2 p-1.5 bg-orange-900/20 border border-orange-800/30 rounded">
              <AlertTriangle className="w-3 h-3 text-orange-400 mt-0.5 flex-shrink-0" />
              <span className="text-[9px] text-orange-400/80">
                Human intervention required: {data.human_escalation_reason}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Real Tool Execution (Backend-controlled) */}
      {data.tool_execution_real && data.tool_execution_details && (
        <div className="p-2 bg-dark-900 rounded-lg border border-green-800/30">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Server className="w-3 h-3 text-green-400" />
              <span className="text-[10px] text-dark-500 uppercase tracking-wider">Real Tool Execution</span>
            </div>
            <Badge
              variant={data.tool_execution_details.success ? 'active' : 'error'}
              className="text-[8px] py-0 px-1"
            >
              {data.tool_execution_details.success ? 'Success' : 'Failed'}
            </Badge>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {/* Tool Name */}
            <div className="flex items-center gap-1.5">
              <Wrench className="w-3 h-3 text-green-400" />
              <span className="text-[10px] text-dark-400 truncate">
                {data.tool_execution_details.tool_name}
              </span>
            </div>

            {/* Tool Type */}
            <div className="flex items-center gap-1.5">
              <Badge variant="default" className="text-[8px] py-0 px-1">
                {data.tool_execution_details.tool_type}
              </Badge>
              {data.tool_execution_details.had_definition && (
                <Badge variant="success" className="text-[8px] py-0 px-1">
                  Dynamic
                </Badge>
              )}
            </div>

            {/* Duration */}
            <div className="flex items-center gap-1.5">
              <Clock className="w-3 h-3 text-dark-500" />
              <span className="text-[10px] text-dark-400">
                {data.tool_execution_details.duration_ms}ms
              </span>
            </div>

            {/* Execution ID */}
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-dark-500 font-mono truncate">
                {data.tool_execution_details.execution_id}
              </span>
            </div>
          </div>

          {/* Error if failed */}
          {!data.tool_execution_details.success && data.tool_execution_details.error_message && (
            <div className="flex items-start gap-2 mt-2 p-1.5 bg-red-900/20 border border-red-800/30 rounded">
              <XCircle className="w-3 h-3 text-red-400 mt-0.5 flex-shrink-0" />
              <span className="text-[9px] text-red-400/80">
                {data.tool_execution_details.error_code}: {data.tool_execution_details.error_message}
              </span>
            </div>
          )}

          {/* Follow-up call info */}
          {data.tool_followup_call?.made && (
            <div className="flex items-center gap-2 mt-2 pt-2 border-t border-dark-800">
              <span className="text-[9px] text-dark-500">Follow-up AI Call:</span>
              <Badge
                variant={data.tool_followup_call.success ? 'active' : 'error'}
                className="text-[8px] py-0 px-1"
              >
                {data.tool_followup_call.success ? 'Success' : 'Failed'}
              </Badge>
              {data.tool_followup_call.tokens && (
                <span className="text-[9px] text-dark-500 font-mono">
                  {data.tool_followup_call.tokens.input}→{data.tool_followup_call.tokens.output} tokens
                </span>
              )}
            </div>
          )}
        </div>
      )}

      {/* Security Check Status */}
      {data.tool_security_checked && (
        <div className={`p-2 bg-dark-900 rounded-lg border ${
          data.tool_security_passed ? 'border-green-800/30' : 'border-red-800/30'
        }`}>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <Shield className={`w-3 h-3 ${data.tool_security_passed ? 'text-green-400' : 'text-red-400'}`} />
              <span className="text-[10px] text-dark-500 uppercase tracking-wider">Security Check</span>
            </div>
            <Badge
              variant={data.tool_security_passed ? 'active' : 'error'}
              className="text-[8px] py-0 px-1"
            >
              {data.tool_security_passed ? 'Passed' : 'Blocked'}
            </Badge>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {/* Policy Applied */}
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-dark-500">Policy:</span>
              <span className={`text-[10px] ${data.security_policy_applied ? 'text-green-400' : 'text-yellow-400'}`}>
                {data.security_policy_applied ? 'Applied' : 'Missing'}
              </span>
            </div>

            {/* Failure Code */}
            {data.security_failure_code && (
              <div className="flex items-center gap-1.5">
                <Badge variant="error" className="text-[8px] py-0 px-1">
                  {data.security_failure_code}
                </Badge>
              </div>
            )}
          </div>

          {/* Failure Reason */}
          {!data.tool_security_passed && data.security_failure_reason && (
            <div className="flex items-start gap-2 mt-2 p-1.5 bg-red-900/20 border border-red-800/30 rounded">
              <XCircle className="w-3 h-3 text-red-400 mt-0.5 flex-shrink-0" />
              <span className="text-[9px] text-red-400/80">
                {data.security_failure_reason}
              </span>
            </div>
          )}
        </div>
      )}

      {/* Input Validation Status */}
      {data.input_validation_checked && (
        <div className={`p-2 bg-dark-900 rounded-lg border ${
          data.input_validation_passed ? 'border-green-800/30' : 'border-red-800/30'
        }`}>
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <FileText className={`w-3 h-3 ${data.input_validation_passed ? 'text-green-400' : 'text-red-400'}`} />
              <span className="text-[10px] text-dark-500 uppercase tracking-wider">Input Validation</span>
            </div>
            <Badge
              variant={data.input_validation_passed ? 'active' : 'error'}
              className="text-[8px] py-0 px-1"
            >
              {data.input_validation_passed ? 'Passed' : 'Failed'}
            </Badge>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {/* Schema Used */}
            <div className="flex items-center gap-1.5">
              <span className="text-[10px] text-dark-500">Schema:</span>
              <span className={`text-[10px] ${data.input_schema_used ? 'text-green-400' : 'text-yellow-400'}`}>
                {data.input_schema_used ? 'Used' : 'Not defined'}
              </span>
            </div>
          </div>

          {/* Validation Errors */}
          {!data.input_validation_passed && data.input_validation_errors && data.input_validation_errors.length > 0 && (
            <div className="flex items-start gap-2 mt-2 p-1.5 bg-red-900/20 border border-red-800/30 rounded">
              <XCircle className="w-3 h-3 text-red-400 mt-0.5 flex-shrink-0" />
              <div className="text-[9px] text-red-400/80">
                {data.input_validation_errors.map((err, idx) => (
                  <div key={idx}>{err}</div>
                ))}
              </div>
            </div>
          )}
        </div>
      )}

      {/* Execution Limits Status */}
      {data.execution_limit_blocked && (
        <div className="p-2 bg-dark-900 rounded-lg border border-orange-800/30">
          <div className="flex items-center justify-between mb-2">
            <div className="flex items-center gap-2">
              <AlertTriangle className="w-3 h-3 text-orange-400" />
              <span className="text-[10px] text-dark-500 uppercase tracking-wider">Execution Limits</span>
            </div>
            <Badge variant="error" className="text-[8px] py-0 px-1">
              Blocked
            </Badge>
          </div>

          <div className="grid grid-cols-2 gap-2">
            {/* Limit Exceeded */}
            {data.limit_exceeded && (
              <div className="flex items-center gap-1.5 col-span-2">
                <span className="text-[10px] text-dark-500">Limit:</span>
                <Badge variant="error" className="text-[8px] py-0 px-1">
                  {data.limit_exceeded.replace(/_/g, ' ')}
                </Badge>
              </div>
            )}

            {/* Execution Count */}
            {typeof data.task_execution_count === 'number' && (
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-dark-500">Executions:</span>
                <span className="text-[10px] text-orange-400 font-mono">{data.task_execution_count}</span>
              </div>
            )}

            {/* Total Time */}
            {typeof data.task_total_execution_ms === 'number' && (
              <div className="flex items-center gap-1.5">
                <span className="text-[10px] text-dark-500">Total Time:</span>
                <span className="text-[10px] text-orange-400 font-mono">{data.task_total_execution_ms}ms</span>
              </div>
            )}
          </div>
        </div>
      )}

      {/* Audit Reference */}
      {data.audit_entry_id && (
        <div className="flex items-center gap-2 p-2 bg-dark-900 rounded-lg">
          <span className="text-[10px] text-dark-500">Audit ID:</span>
          <span className="text-[10px] text-cyan-400 font-mono truncate">{data.audit_entry_id}</span>
        </div>
      )}

      {/* Confirmed tools (if any) */}
      {data.tools_used === true && Array.isArray(data.confirmed_tools) && data.confirmed_tools.length > 0 && (
        <div className="flex items-center gap-2 flex-wrap">
          <span className="text-[10px] text-dark-500">Confirmed:</span>
          {data.confirmed_tools.map(tool => (
            <Badge key={tool} variant="active" className="text-[9px]">
              {tool}
            </Badge>
          ))}
        </div>
      )}

      {/* Evidence summary */}
      <div className="p-2 bg-dark-900 rounded-lg">
        <div className="flex items-center gap-2 mb-1">
          <Layers className="w-3 h-3 text-dark-500" />
          <span className="text-[10px] text-dark-500 uppercase tracking-wider">Evidence</span>
        </div>
        <p className="text-xs text-dark-300">{data.evidence}</p>
        <div className="flex items-center gap-2 mt-1">
          <Badge variant="default" className="text-[8px] py-0 px-1">
            Source: {data.evidence_source}
          </Badge>
        </div>
      </div>

      {/* Notes/Limitations */}
      {data.notes && (
        <div className="flex items-start gap-2 p-2 bg-yellow-900/10 border border-yellow-800/30 rounded-lg">
          <AlertTriangle className="w-3 h-3 text-yellow-400 mt-0.5 flex-shrink-0" />
          <p className="text-[10px] text-yellow-400/80">{data.notes}</p>
        </div>
      )}

      {/* Session info */}
      {(data.sessionKey || data.agentId) && (
        <div className="flex items-center gap-3 text-[10px] text-dark-500">
          {data.sessionKey && (
            <span className="font-mono truncate" title={data.sessionKey}>
              Session: {data.sessionKey.substring(0, 25)}...
            </span>
          )}
          {data.agentId && (
            <span className="font-mono">
              Agent: {data.agentId.substring(0, 8)}
            </span>
          )}
        </div>
      )}

      {/* Phases breakdown */}
      {Array.isArray(data.phases) && data.phases.length > 0 && (
        <div>
          <div className="flex items-center justify-between mb-2">
            <span className="text-[10px] text-dark-500 uppercase tracking-wider">
              Verification Phases
            </span>
            <Badge variant="default" className="text-[9px]">
              {data.phases.length} phases
            </Badge>
          </div>
          <div className="bg-dark-900 rounded-lg overflow-hidden max-h-64 overflow-y-auto">
            {data.phases.map(phase => (
              <PhaseRow
                key={phase.phase}
                phase={phase}
                isExpanded={expandedPhases.has(phase.phase)}
                onToggle={() => togglePhase(phase.phase)}
              />
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
