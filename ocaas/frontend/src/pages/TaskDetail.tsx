import { useState } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import {
  ArrowLeft,
  XCircle,
  RotateCcw,
  Clock,
  CheckCircle,
  AlertCircle,
  GitBranch,
  FolderTree,
  Zap,
  User,
  Network,
  Activity,
  Flag,
  DollarSign,
  Bug,
  Pause,
  Play,
  Wrench,
  Sparkles,
} from 'lucide-react';
import { DelegationHistory } from '../components/DelegationHistory';
import { taskApi, jobApi, agentApi, orgApi, taskStateApi, budgetApi, generationApi } from '../lib/api';
import { useAppStore } from '../stores/app';
import { Button, Badge, Card, CardHeader } from '../components/ui';
import { SubtasksPanel } from '../components/SubtasksPanel';
import { JobStatusPanel, BlockedJobView } from '../components/jobs';
import {
  ExecutionSummaryPanel,
  TimelinePanel,
  CheckpointsPanel,
  BudgetPanel,
  DiagnosticsPanel,
  TaskDecisionTracePanel,
  GenerationTracePanel,
  ToolUsagePanel,
  TaskManualAgentAssignPanel,
  TaskGenerateAgentFlowPanel,
} from '../components/tasks';
import { TASK_PRIORITY } from '../types';
import { fromTimestamp } from '../lib/date';

const statusVariant = {
  pending: 'pending',
  queued: 'pending',
  assigned: 'pending',
  running: 'active',
  completed: 'success',
  failed: 'error',
  cancelled: 'inactive',
} as const;

const statusIcons = {
  pending: Clock,
  queued: Clock,
  assigned: Clock,
  running: Clock,
  completed: CheckCircle,
  failed: AlertCircle,
  cancelled: XCircle,
};

const priorityLabels: Record<number, string> = {
  [TASK_PRIORITY.LOW]: 'Low',
  [TASK_PRIORITY.NORMAL]: 'Normal',
  [TASK_PRIORITY.HIGH]: 'High',
  [TASK_PRIORITY.CRITICAL]: 'Critical',
};

export function TaskDetail() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { addNotification } = useAppStore();
  const [selectedJobId, setSelectedJobId] = useState<string | null>(null);
  const [showAdvanced, setShowAdvanced] = useState(true);

  const { data: task, isLoading } = useQuery({
    queryKey: ['tasks', id],
    queryFn: () => taskApi.get(id!),
    enabled: !!id,
  });

  // Fetch jobs for this task
  const { data: jobs } = useQuery({
    queryKey: ['jobs', 'task', id],
    queryFn: () => jobApi.getByTask(id!),
    enabled: !!id,
    refetchInterval: 5000, // Poll for updates
  });

  // Fetch agent info if assigned
  const { data: agent } = useQuery({
    queryKey: ['agents', task?.agentId],
    queryFn: () => agentApi.get(task!.agentId!),
    enabled: !!task?.agentId,
  });

  // Fetch agent org profile
  const { data: agentOrgProfile } = useQuery({
    queryKey: ['org', 'profile', task?.agentId],
    queryFn: () => orgApi.getAgentProfile(task!.agentId!),
    enabled: !!task?.agentId,
    retry: false,
  });

  // ============ NEW: Advanced execution data ============
  // All these queries treat 404 as "no data" rather than error
  // This allows the page to remain functional even when some data is unavailable

  // Fetch task diagnostics (includes execution summary, timeline, delegation chain)
  const { data: diagnostics, isLoading: isDiagnosticsLoading } = useQuery({
    queryKey: ['tasks', id, 'diagnostics'],
    queryFn: async () => {
      try {
        return await taskStateApi.getDiagnostics(id!);
      } catch {
        return null; // 404 or error = no diagnostics available
      }
    },
    enabled: !!id,
    refetchInterval: 5000,
    retry: false,
  });

  // Fetch full task execution state
  const { data: taskState, isLoading: isStateLoading } = useQuery({
    queryKey: ['tasks', id, 'state'],
    queryFn: async () => {
      try {
        return await taskStateApi.getState(id!);
      } catch {
        return null; // 404 = state not initialized yet
      }
    },
    enabled: !!id,
    refetchInterval: 5000,
    retry: false,
  });

  // Fetch timeline - backend returns { task_id, timeline, ai_usage, execution_summary }
  const { data: timelineResponse, isLoading: isTimelineLoading } = useQuery({
    queryKey: ['tasks', id, 'timeline'],
    queryFn: async () => {
      try {
        return await taskStateApi.getTimeline(id!);
      } catch {
        return null; // 404 = no timeline available
      }
    },
    enabled: !!id,
    refetchInterval: 10000,
    retry: false,
  });

  // Fetch checkpoints
  const { data: checkpoints, isLoading: isCheckpointsLoading } = useQuery({
    queryKey: ['tasks', id, 'checkpoints'],
    queryFn: async () => {
      try {
        return await taskStateApi.getCheckpoints(id!);
      } catch {
        return []; // 404 = no checkpoints
      }
    },
    enabled: !!id,
    retry: false,
  });

  // Fetch budget/cost for this task
  const { data: taskCost, isLoading: isCostLoading } = useQuery({
    queryKey: ['budget', 'task', id],
    queryFn: async () => {
      try {
        return await budgetApi.getTaskCost(id!);
      } catch {
        return null; // 404 = no cost data
      }
    },
    enabled: !!id,
    retry: false,
  });

  // Fetch decision trace - explains WHY task is queued/pending
  const { data: decisionTrace, isLoading: isDecisionTraceLoading } = useQuery({
    queryKey: ['tasks', id, 'decision-trace'],
    queryFn: async () => {
      try {
        return await taskApi.getDecisionTrace(id!);
      } catch {
        return null; // 404 = no trace available yet
      }
    },
    enabled: !!id && (task?.status === 'queued' || task?.status === 'pending' || task?.status === 'assigned'),
    refetchInterval: 10000,
    retry: false,
  });

  // P0-02: Fetch generation trace - REAL execution traceability
  const { data: generationTrace, isLoading: isGenerationTraceLoading } = useQuery({
    queryKey: ['tasks', id, 'generation-trace'],
    queryFn: async () => {
      try {
        return await taskApi.getGenerationTrace(id!);
      } catch {
        return null; // 404 = no trace available yet
      }
    },
    enabled: !!id,
    refetchInterval: 10000,
    retry: false,
  });

  const cancelMutation = useMutation({
    mutationFn: taskApi.cancel,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks', id] });
      addNotification({ type: 'info', title: 'Task cancelled' });
    },
  });

  const retryMutation = useMutation({
    mutationFn: taskApi.retry,
    onSuccess: () => {
      // Invalidate all task-related queries to refresh UI immediately
      queryClient.invalidateQueries({ queryKey: ['tasks', id] });
      queryClient.invalidateQueries({ queryKey: ['tasks', id, 'decision-trace'] });
      queryClient.invalidateQueries({ queryKey: ['tasks', id, 'state'] });
      queryClient.invalidateQueries({ queryKey: ['tasks', id, 'diagnostics'] });
      queryClient.invalidateQueries({ queryKey: ['tasks', id, 'timeline'] });
      queryClient.invalidateQueries({ queryKey: ['tasks', id, 'checkpoints'] });
      queryClient.invalidateQueries({ queryKey: ['budget', 'task', id] });
      queryClient.invalidateQueries({ queryKey: ['jobs', 'task', id] });
      addNotification({
        type: 'success',
        title: 'Retry triggered',
        message: 'Task has been queued for re-evaluation. Decision trace will update shortly.',
      });
    },
    onError: (error) => {
      addNotification({
        type: 'error',
        title: 'Retry failed',
        message: error instanceof Error ? error.message : 'Failed to retry task',
      });
    },
  });

  // Pause mutation
  const pauseMutation = useMutation({
    mutationFn: (reason?: string) => taskStateApi.pause(id!, reason),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks', id] });
      queryClient.invalidateQueries({ queryKey: ['tasks', id, 'state'] });
      addNotification({ type: 'info', title: 'Task paused' });
    },
  });

  // Resume mutation
  const resumeMutation = useMutation({
    mutationFn: (checkpointId?: string) => taskStateApi.resume(id!, checkpointId),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks', id] });
      queryClient.invalidateQueries({ queryKey: ['tasks', id, 'state'] });
      addNotification({ type: 'success', title: 'Task resumed' });
    },
  });

  // Create checkpoint mutation
  const checkpointMutation = useMutation({
    mutationFn: (label?: string) => taskStateApi.createCheckpoint(id!, label),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks', id, 'checkpoints'] });
      addNotification({ type: 'success', title: 'Checkpoint created' });
    },
  });

  if (isLoading) {
    return <div className="text-center py-8 text-dark-400">Loading...</div>;
  }

  if (!task) {
    return <div className="text-center py-8 text-dark-400">Task not found</div>;
  }

  const StatusIcon = statusIcons[task.status];
  const formatDate = (ts: number | undefined | null) => {
    const date = fromTimestamp(ts);
    return date ? date.toLocaleString() : '-';
  };

  const canCancel = task.status === 'pending' || task.status === 'queued' || task.status === 'running';
  const canRetry = task.status === 'failed';

  // Check if this is a decomposed parent task
  const isDecomposed = Boolean(task.metadata?._decomposed);
  const subtaskCount = (task.metadata?._subtaskCount as number) || 0;

  // Check if this is a subtask
  const isSubtask = Boolean(task.parentTaskId);

  // ============ NEW: Derived state from advanced data ============
  const isPaused = taskState?.pausedAt !== undefined && taskState.pausedAt > 0;
  const canPause = task.status === 'running' && !isPaused;
  const canResume = isPaused;
  // Check for meaningful advanced data (arrays need length check)
  const hasCheckpoints = Array.isArray(checkpoints) && checkpoints.length > 0;
  const hasTimeline = timelineResponse?.timeline && Array.isArray(timelineResponse.timeline) && timelineResponse.timeline.length > 0;
  const hasAdvancedData = diagnostics || taskState || hasTimeline || hasCheckpoints || taskCost;

  return (
    <div className="space-y-6">
      <div className="flex items-center gap-4">
        <Button variant="ghost" onClick={() => navigate('/tasks')}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <div className="flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl font-bold">{task.title}</h1>
            {isDecomposed && (
              <Badge variant="active" className="ml-2">
                <FolderTree className="w-3 h-3 mr-1" />
                Parent ({subtaskCount} subtasks)
              </Badge>
            )}
            {isSubtask && (
              <Badge variant="pending" className="ml-2">
                <GitBranch className="w-3 h-3 mr-1" />
                Subtask
              </Badge>
            )}
          </div>
          <p className="text-dark-500 text-sm">{task.type}</p>
          <p className="text-dark-400">Task ID: {task.id}</p>
          {isSubtask && (
            <p className="text-dark-400 text-sm">
              Parent:{' '}
              <a
                href={`/tasks/${task.parentTaskId}`}
                className="text-primary-400 hover:underline"
                onClick={(e) => {
                  e.preventDefault();
                  navigate(`/tasks/${task.parentTaskId}`);
                }}
              >
                {task.parentTaskId}
              </a>
              {task.sequenceOrder && ` (Step ${task.sequenceOrder})`}
            </p>
          )}
        </div>
        <div className="flex items-center gap-2">
          {canPause && (
            <Button
              variant="secondary"
              onClick={() => pauseMutation.mutate('Manual pause')}
              loading={pauseMutation.isPending}
            >
              <Pause className="w-4 h-4" />
              Pause
            </Button>
          )}
          {canResume && (
            <Button
              variant="primary"
              onClick={() => resumeMutation.mutate(undefined)}
              loading={resumeMutation.isPending}
            >
              <Play className="w-4 h-4" />
              Resume
            </Button>
          )}
          {canCancel && (
            <Button
              variant="danger"
              onClick={() => cancelMutation.mutate(task.id)}
              loading={cancelMutation.isPending}
            >
              <XCircle className="w-4 h-4" />
              Cancel
            </Button>
          )}
          {canRetry && (
            <Button
              variant="primary"
              onClick={() => retryMutation.mutate(task.id)}
              loading={retryMutation.isPending}
            >
              <RotateCcw className="w-4 h-4" />
              Retry
            </Button>
          )}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <Card className="lg:col-span-2">
          <CardHeader title="Details" />
          <div className="grid grid-cols-2 gap-4">
            <div>
              <p className="text-sm text-dark-400">Status</p>
              <div className="flex items-center gap-2 mt-1">
                <StatusIcon className="w-4 h-4" />
                <Badge variant={statusVariant[task.status]}>{task.status}</Badge>
              </div>
            </div>
            <div>
              <p className="text-sm text-dark-400">Priority</p>
              <Badge
                variant={
                  task.priority === TASK_PRIORITY.CRITICAL
                    ? 'error'
                    : task.priority === TASK_PRIORITY.HIGH
                    ? 'pending'
                    : 'default'
                }
                className="mt-1"
              >
                {priorityLabels[task.priority] || task.priority}
              </Badge>
            </div>
            <div className="col-span-2">
              <p className="text-sm text-dark-400">Agent</p>
              {task.agentId ? (
                <div className="flex items-center gap-3 mt-2 p-3 bg-dark-800 rounded-lg">
                  <User className="w-5 h-5 text-dark-400" />
                  <div className="flex-1 min-w-0">
                    <a
                      href={`/agents/${task.agentId}`}
                      className="font-medium text-primary-400 hover:underline"
                      onClick={(e) => {
                        e.preventDefault();
                        navigate(`/agents/${task.agentId}`);
                      }}
                    >
                      {agent?.name || task.agentId}
                    </a>
                    <div className="flex items-center gap-2 mt-1">
                      {agent && (
                        <>
                          <Badge variant="default" className="text-xs">{agent.type}</Badge>
                          <Badge
                            variant={agent.status === 'active' ? 'active' : agent.status === 'busy' ? 'pending' : 'inactive'}
                            className="text-xs"
                          >
                            {agent.status}
                          </Badge>
                        </>
                      )}
                      {agentOrgProfile && (
                        <Badge variant="default" className="text-xs">
                          <Network className="w-3 h-3 mr-1" />
                          {agentOrgProfile.roleType}
                        </Badge>
                      )}
                    </div>
                  </div>
                </div>
              ) : (
                <p className="text-sm mt-1 text-dark-500">Unassigned</p>
              )}
            </div>
            {task.description && (
              <div className="col-span-2">
                <p className="text-sm text-dark-400">Description</p>
                <p className="text-sm mt-1">{task.description}</p>
              </div>
            )}
            {task.delegationHistory && task.delegationHistory.length > 1 && (
              <div className="col-span-2">
                <p className="text-sm text-dark-400 mb-2">Delegation History</p>
                <DelegationHistory history={task.delegationHistory} />
              </div>
            )}
            <div>
              <p className="text-sm text-dark-400">Created</p>
              <p className="text-sm mt-1">{formatDate(task.createdAt)}</p>
            </div>
            <div>
              <p className="text-sm text-dark-400">Started</p>
              <p className="text-sm mt-1">{formatDate(task.startedAt)}</p>
            </div>
            <div>
              <p className="text-sm text-dark-400">Completed</p>
              <p className="text-sm mt-1">{formatDate(task.completedAt)}</p>
            </div>
          </div>
        </Card>

        {task.input && (
          <Card>
            <CardHeader title="Input" />
            <pre className="text-xs font-mono bg-dark-900 p-3 rounded-lg overflow-auto max-h-48">
              {JSON.stringify(task.input, null, 2)}
            </pre>
          </Card>
        )}
      </div>

      {/* Decision Trace Panel - Shows WHY task is queued/pending */}
      {(task.status === 'queued' || task.status === 'pending' || task.status === 'assigned' || decisionTrace) && (
        <Card>
          <CardHeader
            title={
              <div className="flex items-center gap-2">
                <AlertCircle className="w-4 h-4 text-yellow-400" />
                Decision Trace
              </div>
            }
          />
          <TaskDecisionTracePanel
            trace={decisionTrace}
            isLoading={isDecisionTraceLoading}
            taskStatus={task.status}
            canRetry={canRetry}
            isRetrying={retryMutation.isPending}
            onRetry={canRetry ? () => retryMutation.mutate(task.id) : undefined}
          />
        </Card>
      )}

      {/* Manual Agent Assignment Panel - Shows ONLY for states that allow direct assignment
          FSM: queued→assigned, assigned→queued (for reassignment)
          NOT allowed: pending→assigned (must queue first), failed→assigned, completed→assigned */}
      {(task.status === 'queued' || task.status === 'assigned') && (
        <Card>
          <CardHeader
            title={
              <div className="flex items-center gap-2">
                <User className="w-4 h-4 text-primary-400" />
                {task.agentId ? 'Reassign Agent' : 'Manual Agent Assignment'}
              </div>
            }
          />
          <TaskManualAgentAssignPanel
            task={task}
            decisionTrace={decisionTrace}
            currentAgent={agent}
            onAssigned={() => {
              addNotification({
                type: 'success',
                title: task.agentId ? 'Agent reassigned' : 'Agent assigned',
                message: task.agentId
                  ? 'Task has been reassigned to the selected agent'
                  : 'Task has been assigned to the selected agent',
              });
            }}
          />
        </Card>
      )}

      {/* Generate Agent Flow Panel - Shows when no matching agent (based on decisionTrace) */}
      {(task.status === 'queued' || task.status === 'pending' || task.status === 'failed') && decisionTrace && (
        decisionTrace.failureReason === 'NO_AGENT_MATCHING_CAPABILITIES' ||
        decisionTrace.failureReason === 'NO_AGENTS_REGISTERED' ||
        decisionTrace.failureReason === 'NO_ACTIVE_AGENTS'
      ) && (
        <Card>
          <CardHeader
            title={
              <div className="flex items-center gap-2">
                <Sparkles className="w-4 h-4 text-primary-400" />
                Generate Compatible Resources
              </div>
            }
          />
          <TaskGenerateAgentFlowPanel
            task={task}
            decisionTrace={decisionTrace}
            onComplete={() => {
              addNotification({
                type: 'info',
                title: 'Generations created',
                message: 'Resources created. Approve and activate them, then retry this task.',
              });
            }}
          />
        </Card>
      )}

      {task.output && (
        <Card>
          <CardHeader title="Output" />
          <pre className="text-xs font-mono bg-dark-900 p-3 rounded-lg overflow-auto max-h-64">
            {JSON.stringify(task.output, null, 2)}
          </pre>
        </Card>
      )}

      {task.error && (
        <Card>
          <CardHeader title="Error" />
          <div className="p-3 bg-red-900/20 border border-red-800 rounded-lg">
            <p className="text-red-400 font-mono text-sm">{task.error}</p>
          </div>
        </Card>
      )}

      {/* Jobs Section */}
      {jobs && jobs.length > 0 && (
        <Card>
          <CardHeader
            title={
              <div className="flex items-center gap-2">
                <Zap className="w-4 h-4 text-primary-400" />
                Jobs ({jobs.length})
              </div>
            }
          />
          <div className="grid grid-cols-1 lg:grid-cols-2 gap-4 p-4">
            <div>
              <JobStatusPanel
                jobs={jobs}
                selectedJobId={selectedJobId}
                onSelectJob={setSelectedJobId}
              />
            </div>
            <div>
              {/* Show blocked job details if selected */}
              {selectedJobId && (() => {
                const selectedJob = jobs.find(j => j.id === selectedJobId);
                if (selectedJob?.blocked) {
                  return (
                    <BlockedJobView
                      blocked={selectedJob.blocked}
                      jobId={selectedJob.id}
                      onApproveGeneration={async (suggestion) => {
                        // Map suggestion type to generation type
                        const typeMap: Record<string, string> = {
                          create_tool: 'tool',
                          create_skill: 'skill',
                        };
                        const generationType = typeMap[suggestion.type];

                        if (!generationType) {
                          addNotification({
                            type: 'warning',
                            title: 'Cannot auto-generate',
                            message: `${suggestion.type} requires manual action`,
                          });
                          return;
                        }

                        try {
                          addNotification({
                            type: 'info',
                            title: 'Generation started',
                            message: `Creating ${generationType}: ${suggestion.target}...`,
                          });

                          await generationApi.create({
                            type: generationType,
                            name: suggestion.target,
                            description: suggestion.description,
                            prompt: `Auto-generated from blocked job. Task context: ${task?.type || 'unknown'}. Original description: ${suggestion.description}`,
                          });

                          queryClient.invalidateQueries({ queryKey: ['generations'] });
                          addNotification({
                            type: 'success',
                            title: 'Generation created',
                            message: `${suggestion.target} generation is pending approval`,
                          });
                        } catch (err) {
                          addNotification({
                            type: 'error',
                            title: 'Generation failed',
                            message: err instanceof Error ? err.message : 'Unknown error',
                          });
                        }
                      }}
                      onReject={async () => {
                        await jobApi.abort(selectedJob.id);
                        queryClient.invalidateQueries({ queryKey: ['jobs'] });
                        addNotification({ type: 'info', title: 'Job cancelled' });
                      }}
                    />
                  );
                }
                if (selectedJob?.result?.output) {
                  return (
                    <Card className="h-full">
                      <CardHeader title="Job Output" />
                      <pre className="text-xs font-mono bg-dark-900 p-3 rounded-lg overflow-auto max-h-64">
                        {selectedJob.result.output}
                      </pre>
                    </Card>
                  );
                }
                if (selectedJob?.error) {
                  return (
                    <Card className="h-full border-red-500/30">
                      <CardHeader title="Job Error" />
                      <div className="p-3 bg-red-900/20 border border-red-800 rounded-lg">
                        <p className="text-red-400 font-mono text-sm">{selectedJob.error.message}</p>
                        {selectedJob.error.retryable && (
                          <Button
                            size="sm"
                            className="mt-2"
                            onClick={async () => {
                              await jobApi.retry(selectedJob.id);
                              queryClient.invalidateQueries({ queryKey: ['jobs'] });
                              addNotification({ type: 'success', title: 'Job retried' });
                            }}
                          >
                            <RotateCcw className="w-3 h-3 mr-1" />
                            Retry
                          </Button>
                        )}
                      </div>
                    </Card>
                  );
                }
                return (
                  <div className="text-center py-8 text-dark-400">
                    <p>Select a job to see details</p>
                  </div>
                );
              })()}
            </div>
          </div>
        </Card>
      )}

      {/* ============ ADVANCED EXECUTION PANELS ============ */}
      {hasAdvancedData && (
        <>
          {/* Toggle for advanced view */}
          <div className="flex items-center justify-between">
            <h2 className="text-lg font-semibold flex items-center gap-2">
              <Activity className="w-5 h-5 text-primary-400" />
              Execution Details
            </h2>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => setShowAdvanced(!showAdvanced)}
            >
              {showAdvanced ? 'Hide Details' : 'Show Details'}
            </Button>
          </div>

          {showAdvanced && (
            <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-6">
              {/* Execution Summary Panel */}
              <Card>
                <CardHeader
                  title={
                    <div className="flex items-center gap-2">
                      <Activity className="w-4 h-4 text-blue-400" />
                      Execution Summary
                    </div>
                  }
                />
                <ExecutionSummaryPanel
                  execution={diagnostics?.execution}
                  state={taskState}
                  isLoading={isDiagnosticsLoading || isStateLoading}
                />
              </Card>

              {/* Timeline Panel */}
              <Card>
                <CardHeader
                  title={
                    <div className="flex items-center gap-2">
                      <Clock className="w-4 h-4 text-purple-400" />
                      Timeline
                    </div>
                  }
                />
                <div className="max-h-80 overflow-y-auto">
                  <TimelinePanel
                    events={timelineResponse?.timeline || diagnostics?.timeline || []}
                    isLoading={isTimelineLoading}
                    maxItems={15}
                  />
                </div>
              </Card>

              {/* Checkpoints Panel */}
              <Card>
                <CardHeader
                  title={
                    <div className="flex items-center gap-2">
                      <Flag className="w-4 h-4 text-yellow-400" />
                      Checkpoints
                    </div>
                  }
                  action={
                    task.status === 'running' && (
                      <Button
                        size="sm"
                        variant="ghost"
                        onClick={() => checkpointMutation.mutate('Manual checkpoint')}
                        loading={checkpointMutation.isPending}
                      >
                        <Flag className="w-3 h-3 mr-1" />
                        Create
                      </Button>
                    )
                  }
                />
                <div className="max-h-60 overflow-y-auto">
                  <CheckpointsPanel
                    checkpoints={checkpoints || taskState?.checkpoints || []}
                    isLoading={isCheckpointsLoading}
                    onRestore={(checkpointId) => resumeMutation.mutate(checkpointId)}
                    canRestore={canResume}
                  />
                </div>
              </Card>

              {/* Budget Panel */}
              <Card>
                <CardHeader
                  title={
                    <div className="flex items-center gap-2">
                      <DollarSign className="w-4 h-4 text-green-400" />
                      Budget & Cost
                    </div>
                  }
                />
                <BudgetPanel
                  cost={taskCost}
                  isLoading={isCostLoading}
                />
              </Card>

              {/* P0-02: Generation Trace Panel */}
              <Card className="lg:col-span-2">
                <CardHeader
                  title={
                    <div className="flex items-center gap-2">
                      <Zap className="w-4 h-4 text-cyan-400" />
                      Generation Trace
                    </div>
                  }
                />
                <GenerationTracePanel
                  trace={generationTrace}
                  isLoading={isGenerationTraceLoading}
                />
              </Card>

              {/* P0-03: Tool Usage Panel */}
              <Card>
                <CardHeader
                  title={
                    <div className="flex items-center gap-2">
                      <Wrench className="w-4 h-4 text-cyan-400" />
                      Tool Usage
                    </div>
                  }
                />
                <ToolUsagePanel
                  toolExecutions={taskState?.toolExecutions}
                  toolCallsCount={taskState?.toolCallsCount}
                  lastToolUsed={taskState?.lastToolUsed}
                  isLoading={isStateLoading}
                />
              </Card>

              {/* Diagnostics Panel */}
              <Card className="lg:col-span-2">
                <CardHeader
                  title={
                    <div className="flex items-center gap-2">
                      <Bug className="w-4 h-4 text-orange-400" />
                      Diagnostics
                    </div>
                  }
                />
                <DiagnosticsPanel
                  diagnostics={diagnostics}
                  state={taskState}
                  isLoading={isDiagnosticsLoading || isStateLoading}
                />
              </Card>
            </div>
          )}
        </>
      )}

      {/* Subtasks panel - only shown for decomposed parent tasks */}
      {isDecomposed && (
        <SubtasksPanel parentTaskId={task.id} parentTitle={task.title} />
      )}
    </div>
  );
}
