import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Plus, ListTodo, XCircle, RotateCcw, Filter, FolderTree, GitBranch, CheckCircle, AlertCircle, Sparkles } from 'lucide-react';
import { taskApi } from '../lib/api';
import { useAppStore } from '../stores/app';
import {
  Button,
  Badge,
  Modal,
  Input,
  Textarea,
  Select,
  Table,
  TableHead,
  TableBody,
  TableRow,
  TableHeader,
  TableCell,
  Card,
  CardHeader,
  EmptyState,
} from '../components/ui';

import { TASK_PRIORITY } from '../types';
import { fromTimestamp } from '../lib/date';

function TruthBadge({ truth }: { truth?: { level: string; reason: string } }) {
  if (!truth) return null;

  const config: Record<string, { color: string; label: string; icon?: React.ElementType }> = {
    real: { color: 'text-green-400', label: 'Verified', icon: CheckCircle },
    fallback: { color: 'text-yellow-400', label: 'Fallback', icon: AlertCircle },
    stub: { color: 'text-blue-400', label: 'Stub', icon: Sparkles },
    uncertain: { color: 'text-dark-500', label: 'Uncertain' },
  };

  const item = config[truth.level] || config.uncertain;
  const Icon = item.icon;

  return (
    <span className={`inline-flex items-center gap-1 text-[10px] uppercase font-bold px-1.5 py-0.5 rounded bg-dark-900 ${item.color} ml-2`} title={truth.reason}>
      {Icon && <Icon className="w-2.5 h-2.5" />}
      {item.label}
    </span>
  );
}

const statusVariant = {
  pending: 'pending',
  queued: 'pending',
  assigned: 'pending',
  running: 'active',
  completed: 'success',
  failed: 'error',
  cancelled: 'inactive',
} as const;

const priorityLabels: Record<number, string> = {
  [TASK_PRIORITY.LOW]: 'Low',
  [TASK_PRIORITY.NORMAL]: 'Normal',
  [TASK_PRIORITY.HIGH]: 'High',
  [TASK_PRIORITY.CRITICAL]: 'Critical',
};

const priorityOptions = [
  { value: String(TASK_PRIORITY.LOW), label: 'Low' },
  { value: String(TASK_PRIORITY.NORMAL), label: 'Normal' },
  { value: String(TASK_PRIORITY.HIGH), label: 'High' },
  { value: String(TASK_PRIORITY.CRITICAL), label: 'Critical' },
];

const statusOptions = [
  { value: '', label: 'All' },
  { value: 'pending', label: 'Pending' },
  { value: 'queued', label: 'Queued' },
  { value: 'running', label: 'Running' },
  { value: 'completed', label: 'Completed' },
  { value: 'failed', label: 'Failed' },
];

export function Tasks() {
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { addNotification } = useAppStore();
  const [showCreate, setShowCreate] = useState(false);
  const [statusFilter, setStatusFilter] = useState('');
  const [form, setForm] = useState({
    title: '',
    description: '',
    type: '',
    priority: String(TASK_PRIORITY.NORMAL),
    // PROMPT 10: Enriched task fields
    objective: '',
    constraints: '',
    details: '',
    expectedOutput: '',
  });

  const { data, isLoading } = useQuery({
    queryKey: ['tasks', statusFilter],
    queryFn: () => taskApi.list(statusFilter ? { status: statusFilter } : undefined),
  });

  const createMutation = useMutation({
    mutationFn: taskApi.create,
    onSuccess: (result) => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      setShowCreate(false);
      setForm({
        title: '',
        description: '',
        type: '',
        priority: String(TASK_PRIORITY.NORMAL),
        objective: '',
        constraints: '',
        details: '',
        expectedOutput: '',
      });
      addNotification({ type: 'success', title: 'Task created' });
      
      // Redirect to task detail for immediate visibility
      if (result?.id) {
        navigate(`/tasks/${result.id}`);
      }
    },
    onError: (err: Error) => {
      addNotification({ type: 'error', title: 'Failed to create task', message: err.message });
    },
  });

  const cancelMutation = useMutation({
    mutationFn: taskApi.cancel,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      addNotification({ type: 'info', title: 'Task cancelled' });
    },
  });

  const retryMutation = useMutation({
    mutationFn: taskApi.retry,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      addNotification({ type: 'success', title: 'Task retried' });
    },
  });

  const handleCreate = (e: React.FormEvent) => {
    e.preventDefault();
    // PROMPT 10: Include enriched fields (only if not empty)
    const payload: Parameters<typeof taskApi.create>[0] = {
      title: form.title,
      description: form.description || undefined,
      type: form.type,
      priority: Number(form.priority),
    };
    if (form.objective) payload.objective = form.objective;
    if (form.constraints) payload.constraints = form.constraints;
    if (form.details) payload.details = form.details;
    if (form.expectedOutput) payload.expectedOutput = form.expectedOutput;

    createMutation.mutate(payload);
  };

  const tasks = data?.tasks || [];
  const formatDate = (ts: number | null) => {
    const date = fromTimestamp(ts);
    return date ? date.toLocaleString() : '-';
  };

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader
          title="Tasks"
          description="Manage task queue"
          action={
            <div className="flex items-center gap-3">
              <Select
                value={statusFilter}
                onChange={(e) => setStatusFilter(e.target.value)}
                options={statusOptions}
              />
              <Button onClick={() => setShowCreate(true)}>
                <Plus className="w-4 h-4" />
                New Task
              </Button>
            </div>
          }
        />

        {isLoading ? (
          <div className="text-center py-8 text-dark-400">Loading...</div>
        ) : tasks.length === 0 ? (
          <EmptyState
            icon={ListTodo}
            title="No tasks"
            description={statusFilter ? 'No tasks match the filter' : 'Create a task to get started'}
            action={
              statusFilter ? (
                <Button variant="secondary" onClick={() => setStatusFilter('')}>
                  <Filter className="w-4 h-4" />
                  Clear Filter
                </Button>
              ) : (
                <Button onClick={() => setShowCreate(true)}>
                  <Plus className="w-4 h-4" />
                  Create Task
                </Button>
              )
            }
          />
        ) : (
          <Table>
            <TableHead>
              <TableRow>
                <TableHeader>Title</TableHeader>
                <TableHeader>Status</TableHeader>
                <TableHeader>Priority</TableHeader>
                <TableHeader>Agent</TableHeader>
                <TableHeader>Created</TableHeader>
                <TableHeader className="text-right">Actions</TableHeader>
              </TableRow>
            </TableHead>
            <TableBody>
              {tasks.map((task) => (
                <TableRow
                  key={task.id}
                  onClick={() => navigate(`/tasks/${task.id}`)}
                >
                  <TableCell>
                    <div className="flex items-start gap-2">
                      {/* Hierarchy indicator */}
                      {task.metadata?._decomposed ? (
                        <span title="Parent task (decomposed)">
                          <FolderTree className="w-4 h-4 text-green-400 mt-0.5 flex-shrink-0" />
                        </span>
                      ) : task.parentTaskId ? (
                        <span title="Subtask">
                          <GitBranch className="w-4 h-4 text-yellow-400 mt-0.5 flex-shrink-0" />
                        </span>
                      ) : null}
                      <div>
                        <p className="font-medium">{task.title}</p>
                        <div className="flex items-center gap-2">
                          <span className="text-dark-500 text-xs">{task.type}</span>
                          {task.parentTaskId && (
                            <span className="text-dark-500 text-xs">
                              Step {task.sequenceOrder || '?'}
                            </span>
                          )}
                        </div>
                      </div>
                    </div>
                  </TableCell>
                  <TableCell>
                    <div className="flex items-center">
                      <Badge variant={statusVariant[task.status]}>
                        {task.status}
                      </Badge>
                      {task.status === 'completed' && (
                        <TruthBadge truth={task.metadata?._truth as any} />
                      )}
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge
                      variant={
                        task.priority === TASK_PRIORITY.CRITICAL
                          ? 'error'
                          : task.priority === TASK_PRIORITY.HIGH
                          ? 'pending'
                          : 'default'
                      }
                    >
                      {priorityLabels[task.priority] || task.priority}
                    </Badge>
                  </TableCell>
                  <TableCell>{task.agentId || '-'}</TableCell>
                  <TableCell className="text-dark-400 text-xs">
                    {formatDate(task.createdAt)}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex items-center justify-end gap-2">
                      {(task.status === 'pending' || task.status === 'queued' || task.status === 'running') && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            cancelMutation.mutate(task.id);
                          }}
                        >
                          <XCircle className="w-4 h-4" />
                        </Button>
                      )}
                      {task.status === 'failed' && task.retryCount < task.maxRetries && (
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={(e) => {
                            e.stopPropagation();
                            retryMutation.mutate(task.id);
                          }}
                        >
                          <RotateCcw className="w-4 h-4" />
                        </Button>
                      )}
                    </div>
                  </TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        )}
      </Card>

      <Modal
        isOpen={showCreate}
        onClose={() => setShowCreate(false)}
        title="Create Task"
        size="lg"
      >
        <form onSubmit={handleCreate} className="space-y-4">
          <Input
            label="Title"
            placeholder="Task title"
            value={form.title}
            onChange={(e) => setForm({ ...form, title: e.target.value })}
            required
          />
          <Textarea
            label="Description"
            value={form.description}
            onChange={(e) => setForm({ ...form, description: e.target.value })}
          />
          <Input
            label="Type"
            placeholder="e.g., code_review, test_run"
            value={form.type}
            onChange={(e) => setForm({ ...form, type: e.target.value })}
            required
          />
          <Select
            label="Priority"
            value={form.priority}
            onChange={(e) => setForm({ ...form, priority: e.target.value })}
            options={priorityOptions}
          />

          {/* PROMPT 10: Enriched task fields (all optional) */}
          <div className="border-t border-dark-700 pt-4 mt-4">
            <p className="text-sm text-dark-400 mb-3">Advanced Task Details (optional)</p>
            <div className="space-y-4">
              <Textarea
                label="Objective"
                placeholder="What should be accomplished?"
                value={form.objective}
                onChange={(e) => setForm({ ...form, objective: e.target.value })}
                rows={2}
              />
              <Textarea
                label="Constraints"
                placeholder="Any limitations or requirements?"
                value={form.constraints}
                onChange={(e) => setForm({ ...form, constraints: e.target.value })}
                rows={2}
              />
              <Textarea
                label="Details"
                placeholder="Additional context or data (JSON or text)"
                value={form.details}
                onChange={(e) => setForm({ ...form, details: e.target.value })}
                rows={3}
              />
              <Textarea
                label="Expected Output"
                placeholder="What output format is expected?"
                value={form.expectedOutput}
                onChange={(e) => setForm({ ...form, expectedOutput: e.target.value })}
                rows={2}
              />
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-4">
            <Button
              type="button"
              variant="secondary"
              onClick={() => setShowCreate(false)}
            >
              Cancel
            </Button>
            <Button type="submit" loading={createMutation.isPending}>
              Create
            </Button>
          </div>
        </form>
      </Modal>
    </div>
  );
}
