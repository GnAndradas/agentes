/**
 * Skill Execution Panel
 *
 * Component for previewing, validating, and executing a skill.
 * Shows the tool pipeline and execution results.
 */

import { useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import {
  Play,
  CheckCircle,
  XCircle,
  AlertTriangle,
  Clock,
  Loader2,
  Eye,
  ChevronDown,
  ChevronRight,
  Wrench,
} from 'lucide-react';
import { skillApi } from '../../lib/api';
import { useAppStore } from '../../stores/app';
import { Button, Badge, Card, CardHeader } from '../ui';
import type {
  Skill,
  SkillExecutionResult,
  SkillValidationResult,
  ExecutionMode,
} from '../../types';

// Type for detailed error output from API tools
interface ApiToolErrorOutput {
  errorType?: string;
  url?: string;
  method?: string;
  statusCode?: number;
  statusText?: string;
  contentType?: string;
  hint?: string;
  responseBody?: string;
  responsePreview?: string;
}

interface SkillExecutionPanelProps {
  skill: Skill;
  onClose?: () => void;
}

export function SkillExecutionPanel({ skill, onClose }: SkillExecutionPanelProps) {
  const { addNotification } = useAppStore();
  const [input, setInput] = useState<string>('{}');
  const [executionResult, setExecutionResult] = useState<SkillExecutionResult | null>(null);
  const [validationResult, setValidationResult] = useState<SkillValidationResult | null>(null);
  const [expandedTools, setExpandedTools] = useState<Set<string>>(new Set());

  // Fetch execution preview
  const { data: preview, isLoading: loadingPreview } = useQuery({
    queryKey: ['skill-execution-preview', skill.id],
    queryFn: () => skillApi.getExecutionPreview(skill.id),
  });

  // Execute mutation
  const executeMutation = useMutation({
    mutationFn: async (mode: ExecutionMode) => {
      let parsedInput: Record<string, unknown> = {};
      try {
        parsedInput = JSON.parse(input);
      } catch {
        throw new Error('Invalid JSON input');
      }
      return skillApi.execute(skill.id, {
        mode,
        input: parsedInput,
        caller: { type: 'user', id: 'ui', name: 'Dashboard User' },
      });
    },
    onSuccess: (result) => {
      setExecutionResult(result);
      if (result.status === 'success') {
        addNotification({ type: 'success', title: `Skill "${skill.name}" executed successfully` });
      } else {
        addNotification({ type: 'error', title: `Skill "${skill.name}" execution failed`, message: result.error });
      }
    },
    onError: (err: Error) => {
      addNotification({ type: 'error', title: 'Execution failed', message: err.message });
    },
  });

  // Validate mutation
  const validateMutation = useMutation({
    mutationFn: async () => {
      let parsedInput: Record<string, unknown> = {};
      try {
        parsedInput = JSON.parse(input);
      } catch {
        throw new Error('Invalid JSON input');
      }
      return skillApi.validateExecution(skill.id, parsedInput);
    },
    onSuccess: (result) => {
      setValidationResult(result);
      if (result.valid) {
        addNotification({ type: 'success', title: 'Validation passed' });
      } else {
        addNotification({ type: 'warning', title: 'Validation found issues' });
      }
    },
    onError: (err: Error) => {
      addNotification({ type: 'error', title: 'Validation failed', message: err.message });
    },
  });

  const toggleTool = (toolId: string) => {
    const next = new Set(expandedTools);
    if (next.has(toolId)) {
      next.delete(toolId);
    } else {
      next.add(toolId);
    }
    setExpandedTools(next);
  };

  const formatDuration = (ms: number) => {
    if (ms < 1000) return `${ms}ms`;
    return `${(ms / 1000).toFixed(2)}s`;
  };

  const statusIcon = (status: string) => {
    switch (status) {
      case 'success':
        return <CheckCircle className="w-4 h-4 text-green-400" />;
      case 'failed':
        return <XCircle className="w-4 h-4 text-red-400" />;
      case 'skipped':
        return <AlertTriangle className="w-4 h-4 text-yellow-400" />;
      case 'running':
        return <Loader2 className="w-4 h-4 text-blue-400 animate-spin" />;
      default:
        return <Clock className="w-4 h-4 text-dark-400" />;
    }
  };

  return (
    <div className="space-y-6">
      {/* Preview Section */}
      <Card>
        <CardHeader
          title="Execution Preview"
          description="Tools that will be executed in this skill"
        />

        {loadingPreview ? (
          <div className="p-4 flex items-center justify-center">
            <Loader2 className="w-5 h-5 animate-spin text-dark-400" />
          </div>
        ) : preview ? (
          <div className="p-4 space-y-4">
            {/* Blockers and Warnings */}
            {preview.blockers.length > 0 && (
              <div className="p-3 bg-red-900/20 border border-red-800 rounded-lg">
                <div className="flex items-center gap-2 text-red-400 mb-2">
                  <XCircle className="w-4 h-4" />
                  <span className="font-medium">Cannot Execute</span>
                </div>
                <ul className="text-sm text-red-300 list-disc list-inside">
                  {preview.blockers.map((b, i) => (
                    <li key={i}>{b}</li>
                  ))}
                </ul>
              </div>
            )}

            {preview.warnings.length > 0 && (
              <div className="p-3 bg-yellow-900/20 border border-yellow-800 rounded-lg">
                <div className="flex items-center gap-2 text-yellow-400 mb-2">
                  <AlertTriangle className="w-4 h-4" />
                  <span className="font-medium">Warnings</span>
                </div>
                <ul className="text-sm text-yellow-300 list-disc list-inside">
                  {preview.warnings.map((w, i) => (
                    <li key={i}>{w}</li>
                  ))}
                </ul>
              </div>
            )}

            {/* Pipeline */}
            <div className="space-y-2">
              <div className="text-sm text-dark-400 font-medium">Pipeline ({preview.pipeline.length} tools)</div>
              {preview.pipeline.map((step, i) => (
                <div
                  key={step.toolId}
                  className="flex items-center gap-3 p-3 bg-dark-900 rounded-lg"
                >
                  <div className="w-6 h-6 flex items-center justify-center bg-dark-800 rounded text-xs font-mono text-dark-400">
                    {i + 1}
                  </div>
                  <Wrench className="w-4 h-4 text-dark-400" />
                  <div className="flex-1">
                    <div className="font-medium">{step.toolName}</div>
                    <div className="text-xs text-dark-500">
                      {step.toolType} • {step.required ? 'Required' : 'Optional'}
                      {step.role && ` • ${step.role}`}
                    </div>
                  </div>
                  <Badge variant={step.status === 'active' ? 'active' : step.status === 'deprecated' ? 'pending' : 'error'}>
                    {step.status}
                  </Badge>
                </div>
              ))}
            </div>

            {preview.estimatedTotalDurationMs && (
              <div className="text-sm text-dark-500">
                Estimated duration: {formatDuration(preview.estimatedTotalDurationMs)}
              </div>
            )}
          </div>
        ) : null}
      </Card>

      {/* Input Section */}
      <Card>
        <CardHeader title="Execution Input" description="JSON input data for the skill pipeline" />
        <div className="p-4">
          <textarea
            value={input}
            onChange={(e) => setInput(e.target.value)}
            className="w-full h-32 px-3 py-2 bg-dark-900 border border-dark-700 rounded-lg font-mono text-sm resize-y focus:outline-none focus:border-dark-500"
            placeholder='{"key": "value"}'
          />
        </div>
      </Card>

      {/* Action Buttons */}
      <div className="flex gap-3">
        <Button
          onClick={() => validateMutation.mutate()}
          disabled={validateMutation.isPending || !preview?.canExecute}
          variant="secondary"
        >
          {validateMutation.isPending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Eye className="w-4 h-4" />
          )}
          Validate
        </Button>
        <Button
          onClick={() => executeMutation.mutate('dry_run')}
          disabled={executeMutation.isPending || !preview?.canExecute}
          variant="secondary"
        >
          {executeMutation.isPending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Play className="w-4 h-4" />
          )}
          Dry Run
        </Button>
        <Button
          onClick={() => executeMutation.mutate('run')}
          disabled={executeMutation.isPending || !preview?.canExecute}
        >
          {executeMutation.isPending ? (
            <Loader2 className="w-4 h-4 animate-spin" />
          ) : (
            <Play className="w-4 h-4" />
          )}
          Execute
        </Button>
      </div>

      {/* Validation Result */}
      {validationResult && (
        <Card>
          <CardHeader
            title="Validation Result"
            description={validationResult.valid ? 'All checks passed' : 'Issues found'}
          />
          <div className="p-4 space-y-3">
            <div className="flex items-center gap-2">
              {validationResult.valid ? (
                <CheckCircle className="w-5 h-5 text-green-400" />
              ) : (
                <XCircle className="w-5 h-5 text-red-400" />
              )}
              <span className={validationResult.valid ? 'text-green-400' : 'text-red-400'}>
                {validationResult.valid ? 'Valid' : 'Invalid'}
              </span>
              <span className="text-dark-500 text-sm">
                ({validationResult.toolsChecked} tools checked, {validationResult.toolsWithIssues} with issues)
              </span>
            </div>

            {validationResult.errors.length > 0 && (
              <div className="space-y-1">
                <div className="text-sm text-red-400 font-medium">Errors</div>
                {validationResult.errors.map((e, i) => (
                  <div key={i} className="text-sm text-red-300 pl-4">
                    • [{e.code}] {e.message}
                  </div>
                ))}
              </div>
            )}

            {validationResult.warnings.length > 0 && (
              <div className="space-y-1">
                <div className="text-sm text-yellow-400 font-medium">Warnings</div>
                {validationResult.warnings.map((w, i) => (
                  <div key={i} className="text-sm text-yellow-300 pl-4">
                    • [{w.code}] {w.message}
                  </div>
                ))}
              </div>
            )}
          </div>
        </Card>
      )}

      {/* Execution Result */}
      {executionResult && (
        <Card>
          <CardHeader
            title="Execution Result"
            description={`${executionResult.mode} mode • ${formatDuration(executionResult.totalDurationMs)}`}
          />
          <div className="p-4 space-y-4">
            {/* Summary */}
            <div className="flex items-center gap-4">
              <div className="flex items-center gap-2">
                {statusIcon(executionResult.status)}
                <span className={
                  executionResult.status === 'success' ? 'text-green-400' :
                  executionResult.status === 'failed' ? 'text-red-400' : 'text-dark-400'
                }>
                  {executionResult.status.toUpperCase()}
                </span>
              </div>
              <div className="text-sm text-dark-500">
                {executionResult.toolsSucceeded} succeeded •
                {executionResult.toolsFailed} failed •
                {executionResult.toolsSkipped} skipped
              </div>
            </div>

            {executionResult.error && (
              <div className="p-3 bg-red-900/20 border border-red-800 rounded-lg text-sm text-red-300">
                {executionResult.error}
              </div>
            )}

            {/* Tool Results */}
            <div className="space-y-2">
              <div className="text-sm text-dark-400 font-medium">Tool Results</div>
              {executionResult.toolResults.map((tr) => (
                <div key={tr.toolId} className="bg-dark-900 rounded-lg overflow-hidden">
                  <button
                    onClick={() => toggleTool(tr.toolId)}
                    className="w-full flex items-center gap-3 p-3 hover:bg-dark-800 transition-colors"
                  >
                    {expandedTools.has(tr.toolId) ? (
                      <ChevronDown className="w-4 h-4 text-dark-400" />
                    ) : (
                      <ChevronRight className="w-4 h-4 text-dark-400" />
                    )}
                    {statusIcon(tr.status)}
                    <span className="flex-1 text-left font-medium">{tr.toolName}</span>
                    <span className="text-xs text-dark-500">{formatDuration(tr.durationMs)}</span>
                    <Badge variant={tr.required ? 'default' : 'inactive'}>
                      {tr.required ? 'required' : 'optional'}
                    </Badge>
                  </button>

                  {expandedTools.has(tr.toolId) && (
                    <div className="p-3 pt-0 border-t border-dark-800 space-y-3">
                      {tr.error && (
                        <div className="p-3 bg-red-900/20 border border-red-800 rounded-lg">
                          <div className="text-sm text-red-400 font-medium mb-1">Error</div>
                          <div className="text-sm text-red-300">{tr.error}</div>

                          {/* Detailed error info from output */}
                          {tr.output && typeof tr.output === 'object' && 'errorType' in tr.output && (() => {
                            const errOutput = tr.output as ApiToolErrorOutput;
                            return (
                              <div className="mt-3 pt-3 border-t border-red-800/50 space-y-2 text-xs">
                                {errOutput.errorType && (
                                  <div className="flex gap-2">
                                    <span className="text-red-400/70">Type:</span>
                                    <span className="text-red-300 font-mono">{errOutput.errorType}</span>
                                  </div>
                                )}
                                {errOutput.url && (
                                  <div className="flex gap-2">
                                    <span className="text-red-400/70">URL:</span>
                                    <span className="text-red-300 font-mono break-all">{errOutput.url}</span>
                                  </div>
                                )}
                                {errOutput.method && (
                                  <div className="flex gap-2">
                                    <span className="text-red-400/70">Method:</span>
                                    <span className="text-red-300 font-mono">{errOutput.method}</span>
                                  </div>
                                )}
                                {errOutput.statusCode && (
                                  <div className="flex gap-2">
                                    <span className="text-red-400/70">Status:</span>
                                    <span className="text-red-300 font-mono">{errOutput.statusCode} {errOutput.statusText || ''}</span>
                                  </div>
                                )}
                                {errOutput.contentType && (
                                  <div className="flex gap-2">
                                    <span className="text-red-400/70">Content-Type:</span>
                                    <span className="text-red-300 font-mono">{errOutput.contentType}</span>
                                  </div>
                                )}
                                {errOutput.hint && (
                                  <div className="mt-2 p-2 bg-yellow-900/20 border border-yellow-800/50 rounded text-yellow-300">
                                    💡 {errOutput.hint}
                                  </div>
                                )}
                                {(errOutput.responseBody || errOutput.responsePreview) && (
                                  <div className="mt-2">
                                    <span className="text-red-400/70 block mb-1">Response:</span>
                                    <pre className="p-2 bg-dark-950 rounded text-red-300/80 overflow-x-auto max-h-32 overflow-y-auto">
                                      {errOutput.responseBody || errOutput.responsePreview}
                                    </pre>
                                  </div>
                                )}
                              </div>
                            );
                          })()}
                        </div>
                      )}
                      {tr.output && tr.status === 'success' && (
                        <div className="text-sm">
                          <span className="text-dark-400 font-medium">Output:</span>
                          <pre className="mt-1 p-2 bg-dark-800 rounded text-xs overflow-x-auto max-h-48 overflow-y-auto">
                            {JSON.stringify(tr.output, null, 2)}
                          </pre>
                        </div>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>

            {/* Final Output */}
            {executionResult.output && (
              <div>
                <div className="text-sm text-dark-400 font-medium mb-2">Final Output</div>
                <pre className="p-3 bg-dark-800 rounded-lg text-xs overflow-x-auto">
                  {JSON.stringify(executionResult.output, null, 2)}
                </pre>
              </div>
            )}
          </div>
        </Card>
      )}

      {/* Close button */}
      {onClose && (
        <div className="flex justify-end">
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      )}
    </div>
  );
}
