import { useState } from 'react';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import { useNavigate } from 'react-router-dom';
import { Plus, ListTodo, XCircle, RotateCcw, Filter } from 'lucide-react';
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
  });

  const { data, isLoading } = useQuery({
    queryKey: ['tasks', statusFilter],
    queryFn: () => taskApi.list(statusFilter ? { status: statusFilter } : undefined),
  });

  const createMutation = useMutation({
    mutationFn: taskApi.create,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['tasks'] });
      setShowCreate(false);
      setForm({ title: '', description: '', type: '', priority: String(TASK_PRIORITY.NORMAL) });
      addNotification({ type: 'success', title: 'Task created' });
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
    createMutation.mutate({
      title: form.title,
      description: form.description,
      type: form.type,
      priority: Number(form.priority),
    });
  };

  const tasks = data?.tasks || [];
  const formatDate = (ts: number | null) =>
    ts ? new Date(ts).toLocaleString() : '-';

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
                    <div>
                      <p className="font-medium">{task.title}</p>
                      <p className="text-dark-500 text-xs">{task.type}</p>
                    </div>
                  </TableCell>
                  <TableCell>
                    <Badge variant={statusVariant[task.status]}>
                      {task.status}
                    </Badge>
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
                      {task.status === 'failed' && task.attempts < task.maxAttempts && (
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
